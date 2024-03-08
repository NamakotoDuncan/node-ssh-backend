const express = require('express');
const sqlite3 = require('sqlite3');
const { Client } = require('ssh2');

const app = express();
const port = 3000;

app.use(express.json());

// SQLite database setup
const db = new sqlite3.Database('clusters.db');

// Create tables in the database
db.serialize(() => {
  db.run('CREATE TABLE IF NOT EXISTS clusters (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP)');
  db.run('CREATE TABLE IF NOT EXISTS nodes (id INTEGER PRIMARY KEY AUTOINCREMENT, cluster_id INTEGER, wsrep_node_name TEXT, wsrep_node_address TEXT)');
});

// API to create a new cluster
app.post('/create-cluster', (req, res) => {
  const { name } = req.body;

  db.run('INSERT INTO clusters (name) VALUES (?)', [name], function (err) {
    if (err) {
      console.error('Error inserting into database:', err.message);
      res.status(500).json({ error: 'Internal Server Error' });
      return;
    }

    const clusterId = this.lastID;
    res.json({ clusterId, success: true });
  });
});

// API to add a node to a cluster
app.post('/add-node/:clusterId', (req, res) => {
  const { wsrepNodeName, wsrepNodeAddress } = req.body;
  const clusterId = req.params.clusterId;

  db.run('INSERT INTO nodes (cluster_id, wsrep_node_name, wsrep_node_address) VALUES (?, ?, ?)', [clusterId, wsrepNodeName, wsrepNodeAddress], (err) => {
    if (err) {
      console.error('Error inserting into database:', err.message);
      res.status(500).json({ error: 'Internal Server Error' });
      return;
    }

    res.json({ success: true });
  });
});

// API to configure the cluster via SSH
app.post('/configure-cluster/:clusterId', (req, res) => {
  const clusterId = req.params.clusterId;

  db.get('SELECT * FROM clusters WHERE id = ?', [clusterId], (err, row) => {
    if (err) {
      console.error('Error retrieving cluster information:', err.message);
      res.status(500).json({ error: 'Internal Server Error' });
      return;
    }

    if (!row) {
      res.status(404).json({ error: 'Cluster not found' });
      return;
    }

    const { name } = row;

    db.all('SELECT * FROM nodes WHERE cluster_id = ?', [clusterId], (err, nodes) => {
      if (err) {
        console.error('Error retrieving nodes information:', err.message);
        res.status(500).json({ error: 'Internal Server Error' });
        return;
      }

      if (nodes.length === 0) {
        res.status(404).json({ error: 'No nodes found for the cluster' });
        return;
      }

      const otherNodesAddresses = nodes.map(n => n.wsrep_node_address).join(',');

      nodes.forEach((node, index) => {
        if (index === 0) {
          addNode(node, nodes, true, res);
        } else {
          addNode(node, otherNodesAddresses, false, res);
        }
      });
    });
  });
});

// API to configure the cluster via SSH
app.post('/join-cluster/', (req, res) => {
  const { nodeId, clusterId, isPrimary, ipAddress } = req.body;

  db.get('SELECT * FROM clusters WHERE id = ?', [clusterId], (err, row) => {
    if (err) {
      console.error('Error retrieving cluster information:', err.message);
      res.status(500).json({ error: 'Internal Server Error' });
      return;
    }

    if (!row) {
      res.status(404).json({ error: 'Cluster not found' });
      return;
    }

    const { name } = row;

    db.all('SELECT * FROM nodes WHERE cluster_id = ?', [clusterId], (err, nodes) => {
      if (err) {
        console.error('Error retrieving nodes information:', err.message);
        res.status(500).json({ error: 'Internal Server Error' });
        return;
      }

      if (nodes.length === 0) {
        res.status(404).json({ error: 'No nodes found for the cluster' });
        return;
      }

      const node = nodes.find(node => node.id === nodeId);
      addNode(node, nodes, isPrimary, res);
    });
  });
});

// Function to add a node to the cluster via SSH
function addNode(node, otherNodesAddresses, isPrimary, res) {
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
    username: 'your-ssh-username',
    password: 'your-ssh-password',
    // Add privateKey if needed
  });
}

// Function to execute SSH commands
function executeCommand(sshClient, commands, index, res) {
  sshClient.exec(commands[index], (err, stream) => {
    if (err) {
      console.error('Error executing command:', err.message);
      res.status(500).json({ error: 'Error executing command' });
      return;
    }

    stream.on('close', () => {
      index += 1;

      if (index < commands.length) {
        executeCommand(sshClient, commands, index, res);
      } else {
        sshClient.end();
        res.json({ success: true });
      }
    });
  });
}

// Start the server
app.listen(port, () => {
  console.log(`Server is running at http://localhost:${port}`);
});
