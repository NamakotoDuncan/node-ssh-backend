const {
  Client
} = require('ssh2');

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
wsrep_cluster_name       = \"galera-cluster-mtrh\"
wsrep_cluster_address    = \"gcomm://172.16.1.232,172.16.1.234,172.16.1.242\"
wsrep_sst_method         = rsync
#wsrep_sst_donor          = 'maria1'
wsrep_node_name          = 'maria3'
wsrep_node_address       = 172.16.1.234
" > /etc/mysql/mariadb.conf.d/60-galera.cnf
`;


const commands = [
  'apt update',
  'apt-get install software-properties-common -y',
  'apt install mariadb-server mariadb-client -y',
  'apt install ansible -y',
  galeraConfigCommand,
  // 'scp playbook.yml root@172.16.0.124:/playbook.yml'
  // 'ls -l', // Example command 1
  // 'uptime', // Example command 2
  // Add more commands here if needed
];

var c = new Client();
let index = 0;

function executeCommand(c, commands, index) {
  c.exec(commands[index], function (err, stream) {
    if (err) {
      console.log("ERROR OCCURED ")
      console.log(err);
      return;
    };

    stream.on('data', function (data, extended) {
      console.log((extended === 'stderr' ? 'STDERR: ' : 'STDOUT: ') +
        data);
    });
    stream.on('end', function () {
      console.log('Stream :: EOF');
    });

    stream.on('close', function () {
      index += 1;
      console.log('Stream :: close');
      if (index < commands.length) {
        console.log('completed comand # '+ index);
        executeCommand(c, commands, index)
      } else {
        c.end();
      }
    });

    stream.on('exit', function (code, signal) {
      console.log('Stream :: exit :: code: ' + code + ', signal: ' + signal);
      // c.end();
    });

  });
}
c.on('connect', function () {
  console.log('Connection :: connect');
});
c.on('ready', function () {
  console.log('Connection :: ready');

  executeCommand(c, commands, index);
});

c.on('error', function (err) {
  console.log('Connection :: error :: ' + err);
});
c.on('end', function () {
  console.log('Connection :: end');
});
c.on('close', function (had_error) {
  console.log('Connection :: close');
});
c.connect({
  //   host: '102.220.22.165',
  host: '172.16.0.137',
  port: 22,
  username: 'root',
  password: 'velo@2023!'
  //   privateKey: require('fs').readFileSync('/here/is/my/key')
});