const express = require("express");
const sqlite3 = require("sqlite3");
const cors = require("cors");
const helmet = require("helmet");
const { Client } = require("ssh2");
const morgan = require("morgan");
const compression = require("compression");

const connectToDatabase = require("./mysql-api");

const app = express();
const http = require('http').createServer(app);
const port = 3000;

app.use(morgan("common"));
app.use(helmet());
app.use(express.json());
app.use(
  cors({
    origin: "*",
    methods: "GET,HEAD,PUT,PATCH,POST,DELETE",
    preflightContinue: false,
    optionsSuccessStatus: 204,
  })
);
app.use(compression());

function clientErrorHandler(err, req, res, next) {
  if (req.xhr) {
    res.status(500).send({ error: "Something failed!" });
  } else {
    next(err);
  }
}

function logErrors(err, req, res, next) {
  console.error(err.stack);
  next(err);
}

app.use(logErrors);
app.use(clientErrorHandler);

const io = require('socket.io')(http, {
  cors: {
    origins: ['http://localhost:8080']
  }
});

io.on('connection', (socket) => {
  console.log('IO -> a user connected');
  socket.on('disconnect', () => {
    console.log('IO -> user disconnected');
  });
});

// SQLite database setup
const db = new sqlite3.Database("clusters.db");

db.serialize(() => {
  // Create clusters table
  db.run(
    "CREATE TABLE IF NOT EXISTS clusters (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP)"
  );

  // Create nodes table
  db.run(
    "CREATE TABLE IF NOT EXISTS nodes (id INTEGER PRIMARY KEY AUTOINCREMENT, cluster_id INTEGER, wsrep_node_name TEXT, wsrep_node_address TEXT)"
  );
});

// Helper function to retrieve multiple rows from the database
const getAllDbData = (query, params) => {
  return new Promise((resolve, reject) => {
    db.all(query, params, (err, rows) => {
      if (err) {
        reject(err);
        return;
      }
      resolve(rows);
    });
  });
};

// API to create a new cluster
app.post("/create-cluster", (req, res, next) => {
  const { name } = req.body;
  try {
    // Store cluster information in SQLite database
    db.run("INSERT INTO clusters (name) VALUES (?)", [name], function (err) {
      if (err) {
        console.error("Error inserting into database:", err.message);
        res.status(500).json({ error: "Internal Server Error" });
        return;
      }

      const clusterId = this.lastID;

      res.json({ clusterId, success: true });
    });
  } catch (err) {
    next(err);
  }
});

// API to get all clusters
app.get("/db-info", async (req, res, next) => {
  try {
    const { user, password } = req.query;
    const nodeId = req.query.nodeId;
    console.log(user + password + nodeId);
    const hostDetais = await getAllDbData("SELECT * FROM nodes WHERE id = ?", [
      nodeId,
    ]);
    if (hostDetais.length > 0) {
      const host = hostDetais[0].wsrep_node_address;
      const dbVariables = await connectToDatabase(host, user, password); //await getAllDbData('SELECT * FROM clusters', []);
      res.json({ hostDetais, dbVariables });
    }
  } catch (err) {
    next(err);
  }
});
// API to get all clusters
app.get("/get-cluster", async (req, res, next) => {
  try {
    // const { name } = req.body;
    const clusters = await getAllDbData("SELECT * FROM clusters", []);
    res.json({ clusters });
  } catch (err) {
    next(err);
  }
});

// API to get a  cluster by id
app.get("/get-cluster-details/:clusterId", async (req, res, next) => {
  try {
    const clusterId = req.params.clusterId;
    const cluster = await getAllDbData("SELECT * FROM clusters where id=?", [
      clusterId,
    ]);
    res.json({ cluster });
  } catch (err) {
    next(err);
  }
});

// API to get a new cluster
app.get("/get-cluster-nodes/:clusterId", async (req, res, next) => {
  try {
    const clusterId = req.params.clusterId;
    const nodes = await getAllDbData(
      "SELECT * FROM nodes WHERE cluster_id = ?",
      [clusterId]
    );
    res.json({ nodes });
  } catch (err) {
    next(err);
  }
});
// API to add a node to a cluster
app.post("/add-node/:clusterId", (req, res, next) => {
  try {
    const { wsrepNodeName, wsrepNodeAddress } = req.body;
    const clusterId = req.params.clusterId;

    // Store node information in the nodes table
    db.run(
      "INSERT INTO nodes (cluster_id, wsrep_node_name, wsrep_node_address) VALUES (?, ?, ?)",
      [clusterId, wsrepNodeName, wsrepNodeAddress],
      (err) => {
        if (err) {
          console.error("Error inserting into database:", err.message);
          res.status(500).json({ error: "Internal Server Error" });
          return;
        }

        // Retrieve the last inserted row ID
        const nodeId = wsrepNodeName;

        res.json({ success: true, nodeId: nodeId });
      }
    );
  } catch (err) {
    next(err);
  }
});

// API to configure the cluster via SSH
app.post("/configure-cluster/:clusterId", (req, res, next) => {
  try {
    const clusterId = req.params.clusterId;

    // Retrieve cluster information from the database
    db.get(
      "SELECT * FROM clusters WHERE wsrep_node_name = ?",
      [clusterId],
      (err, row) => {
        if (err) {
          console.error("Error retrieving cluster information:", err.message);
          res.status(500).json({ error: "Internal Server Error" });
          return;
        }

        if (!row) {
          res.status(404).json({ error: "Cluster not found" });
          return;
        }

        const { name } = row;

        // Retrieve nodes for the cluster
        db.all(
          "SELECT * FROM nodes WHERE cluster_id = ?",
          [clusterId],
          (err, nodes) => {
            if (err) {
              console.error("Error retrieving nodes information:", err.message);
              res.status(500).json({ error: "Internal Server Error" });
              return;
            }

            if (nodes.length === 0) {
              res.status(404).json({ error: "No nodes found for the cluster" });
              return;
            }
            //   let otherNodesAddresses = nodes.map(n=>n.wsrep_node_address).join(',');
            nodes.forEach((node, index) => {
              if (index === 0) {
                addNode(node, nodes, true);
              } else {
                addNode(node, otherNodesAddresses, false);
              }
            });
          }
        );
      }
    );
  } catch (err) {
    next(err);
  }
});

// API to configure the cluster via SSH
app.post("/join-cluster/", (req, res, next) => {
  try {
    const { nodeId, clusterId, isPrimary } = req.body;
    // Retrieve cluster information from the database
    db.get("SELECT * FROM clusters WHERE id = ?", [clusterId], (err, row) => {
      if (err) {
        console.error("Error retrieving cluster information:", err.message);
        res.status(500).json({ error: "Internal Server Error" });
        return;
      }

      if (!row) {
        res.status(404).json({ error: "Cluster not found" });
        return;
      }

      const { name } = row;

      // Retrieve nodes for the cluster
      db.all(
        "SELECT * FROM nodes WHERE cluster_id = ?",
        [clusterId],
        (err, nodes) => {
          if (err) {
            console.error("Error retrieving nodes information:", err.message);
            res.status(500).json({ error: "Internal Server Error" });
            return;
          }

          if (nodes.length === 0) {
            res.status(404).json({ error: "No nodes found for the cluster" });
            return;
          }
          console.log(JSON.stringify(nodes))
          let node = nodes.find((node) => node.id === nodeId);
          console.log(JSON.stringify(node) + "  "+ nodeId)
          addNode(node, nodes, isPrimary, res);
          res.json({msg:'success'})
        }
      );
    });
  } catch (err) {
    next(err);
  }
});

function addNode(node, nodes, isPrimary, res) {
  console.log("ADDING NODE" + JSON.stringify(node) );
  const galeraConfigCommand = `
    echo "
    [galera]
    # Mandatory settings
    wsrep_on                 = ON
    binlog_format            = row
    default_storage_engine   = InnoDB
    innodb_autoinc_lock_mode = 2
    bind-address             = 0.0.0.0
    wsrep_slave_threads      = 1
    innodb_flush_log_at_trx_commit = 0
    innodb_autoinc_lock_mode = 2
    wsrep_provider           = /usr/lib/galera/libgalera_smm.so
    wsrep_cluster_name       = \"galera-cluster-${node.clusterId}\"
    wsrep_cluster_address    = \"gcomm://${nodes
      .map((node) => node.wsrep_node_address)
      .join(",")}\"
    wsrep_sst_method         = rsync
    wsrep_node_name =  ${node.wsrep_node_name}
    ${isPrimary ? "" : "wsrep_sst_donor = " + nodes[0].wsrep_node_name}
    wsrep_node_address = ${node.wsrep_node_address}
    " > /etc/mysql/mariadb.conf.d/60-galera.cnf
  `;
  const grastateConfigCommand=`
      echo "
        version: 2.1
        uuid:    f39f96e8-c9f5-11ee-8a96-6248f8c9713f
        seqno:   -1
        ${isPrimary ? "safe_to_bootstrap: 1" : "safe_to_bootstrap: 0"} "
        > /var/lib/mysql/grastate.dat
  `
  //  wsrep_cluster_address    = \"gcomm://${nodes.map(node => node.wsrep_node_address).join(',')}\"
  //  ${nodes.map((node, index) => `wsrep_node_name_${index + 1} = '${node.wsrep_node_name}'\nwsrep_node_address_${index + 1} = ${node.wsrep_node_address}`).join('\n')}
  const commands = [
    "apt update",
    "apt-get install software-properties-common -y",
    "apt install mariadb-server mariadb-client -y",
    galeraConfigCommand,
    grastateConfigCommand,
    "service mariadb stop",
    "mkdir -p /run/mysqld/",
    "chown -R mysql:mysql /run/mysqld/",
  ];

  // if (isPrimary) {
  //   commands.push("mysqld -umysql --wsrep-new-cluster");
  // } else {
  //   commands.push("mysqld -umysql");
  // }
  const sshClient = new Client();

  sshClient.on("ready", () => {
    executeCommand(sshClient, commands, 0, res);
  });

  sshClient.on("error", (err) => {
    console.error("SSH Connection Error:", err.message);
    res.status(500).json({ error: "SSH Connection Error" });
  });

  sshClient.connect({
    host: nodes[0].wsrep_node_address,
    port: 22,
    username: "root",
    password: "pa55w0rd",
    // Add privateKey if needed
  });
}

function executeCommand(sshClient, commands, index, res) {
  console.log("Executing commands");
  console.log(commands[index]);
  sshClient.exec(commands[index], (err, stream) => {
    // console.log("EXecuting.....");
    if (err) {
      console.error("Error executing command:", err.message);
      res.status(500).json({ error: "Error executing command" });
      return;
    }

    stream.on("data", function (data, extended) {
      console.log((extended === "stderr" ? "STDERR: " : "STDOUT: ") + data);
      io.emit('console-msg', extended === "stderr" ? "STDERR: " : "STDOUT: ") + data;
    });
    stream.on("end", function () {
      console.log("Stream :: EOF");
    });

    stream.on("close", () => {
      index += 1;

      if (index < commands.length) {
        executeCommand(sshClient, commands, index, res);
      } else {
        sshClient.end();
        console.log("COMMAND COMPLETED");
        res.status(200).json({ success: "Node Created" });
        //callback(node,res);
      }
    });
  });
}

// app.use((req, res, next) => {
//   res.header("Access-Control-Allow-Origin", "*");
//   res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept");
//   next();
// });

// app.listen(port, () => {
//   console.log(`Server is running at http://localhost:${port}`);
// });
http.listen(3000, () => {
  console.log('listening on *:3000');
});