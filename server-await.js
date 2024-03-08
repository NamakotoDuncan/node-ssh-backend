const express = require('express');
const sqlite3 = require('sqlite3');
const { Client } = require('ssh2');

const app = express();
const port = 3000;

app.use(express.json());

// SQLite database setup
const db = new sqlite3.Database('clusters.db');

// Helper function to execute database queries
const runDbQuery = (query, params) => {
  return new Promise((resolve, reject) => {
    db.run(query, params, function (err) {
      if (err) {
        reject(err);
        return;
      }
      resolve(this.lastID || this.changes);
    });
  });
};

// Helper function to retrieve data from the database
const getDbData = (query, params) => {
  return new Promise((resolve, reject) => {
    db.get(query, params, (err, row) => {
      if (err) {
        reject(err);
        return;
      }
      resolve(row);
    });
  });
};

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

// SQLite database setup
db.serialize(async () => {
  await runDbQuery('CREATE TABLE IF NOT EXISTS clusters (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP)', []);
  await runDbQuery('CREATE TABLE IF NOT EXISTS nodes (id INTEGER PRIMARY KEY AUTOINCREMENT, cluster_id INTEGER, wsrep_node_name TEXT, wsrep_node_address TEXT)', []);
});

// API to create a new cluster
app.post('/create-cluster', async (req, res) => {
  const { name } = req.body;

  try {
    const clusterId = await runDbQuery('INSERT INTO clusters (name) VALUES (?)', [name]);
    res.json({ clusterId, success: true });
  } catch (err) {
    console.error('Error inserting into database:', err.message);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// API to add a node to a cluster
app.post('/add-node/:clusterId', async (req, res) => {
  const { wsrepNodeName, wsrepNodeAddress } = req.body;
  const clusterId = req.params.clusterId;

  try {
    await runDbQuery('INSERT INTO nodes (cluster_id, wsrep_node_name, wsrep_node_address) VALUES (?, ?, ?)', [clusterId, wsrepNodeName, wsrepNodeAddress]);
    res.json({ success: true });
  } catch (err) {
    console.error('Error inserting into database:', err.message);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});


// API to join the cluster via SSH
app.post('/join-cluster/', async (req, res) => {
  const { nodeId, clusterId, isPrimary } = req.body;

  try {
    const cluster = await getDbData('SELECT * FROM clusters WHERE id = ?', [clusterId]);

    if (!cluster) {
      res.status(404).json({ error: 'Cluster not found' });
      return;
    }

    const nodes = await getAllDbData('SELECT * FROM nodes WHERE cluster_id = ?', [clusterId]);

    if (nodes.length === 0) {
      res.status(404).json({ error: 'No nodes found for the cluster' });
      return;
    }

    const node = nodes.find(node => node.wsrep_node_name === nodeId);
    await addNode(node, nodes, isPrimary, res);
  } catch (err) {
    console.error('Error retrieving data from the database:', err.message);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// Function to add a node to the cluster via SSH
async function addNode(node, otherNodesAddresses, isPrimary, res) {
  console.log('ADDING NODE');
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
    wsrep_cluster_address    = \"gcomm://${otherNodesAddresses}\"
    wsrep_sst_method         = rsync
    wsrep_node_name =  ${node.wsrep_node_name}
    ${isPrimary ? '' : 'wsrep_sst_donor = ' + otherNodesAddresses[0].wsrep_node_name}
    wsrep_node_address = ${node.wsrep_node_address}
    " > /etc/mysql/mariadb.conf.d/60-galera.cnf
  `;

  const commands = [
    'apt update',
    'apt-get install software-properties-common -y',
    'apt install mariadb-server mariadb-client -y',
    galeraConfigCommand,
  ];

  const sshClient = new Client();

  sshClient.on('ready', () => {
    executeCommand(sshClient, commands, 0, res);
  });

  sshClient.on('error', (err) => {
    console.error('SSH Connection Error:', err.message);
    res.status(500).json({ error: 'SSH Connection Error' });
  });

  sshClient.connect({
    host: nodes[0].wsrep_node_address,
    port: 22,
    username: 'root',
    password: 'your-ssh-password',
    // Add privateKey if needed
  });
}

// Function to execute SSH commands
async function executeCommand(sshClient, commands, index, res) {
  console.log("Executing commands");
  console.log(commands[index]);
  sshClient.exec(commands[index], (err, stream) => {
    if (err) {
      console.error('Error executing command:', err.message);
      res.status(500).json({ error: 'Error executing command' });
      return;
    }

    stream.on('data', function (data, extended) {
      console.log((extended === 'stderr' ? 'STDERR: ' : 'STDOUT: ') +
        data);
    });

    stream.on('end', function () {
      console.log('Stream :: EOF');
    });

    stream.on('close', () => {
      index += 1;

      if (index < commands.length) {
        executeCommand(sshClient, commands, index, res);
      } else {
        sshClient.end();
        console.log('COMMAND COMPLETED');
        res.status(200).json({ success: 'Node Created' });
      }
    });
  });
}

// Start the server
app.listen(port, () => {
  console.log(`Server is running at http://localhost:${port}`);
});
