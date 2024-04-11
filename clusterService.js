
// https://galeracluster.com/2016/11/introducing-the-safe-to-bootstrap-feature-in-galera-cluster/
// https://severalnines.com/blog/updated-how-bootstrap-mysql-or-mariadb-galera-cluster/
function initCluster(host,user,password,isPrimary){
// update nano /var/lib/mysql/grastate.dat 
//      GRASTATE CONTENTS
//          version: 2.1
//          uuid:    f39f96e8-c9f5-11ee-8a96-6248f8c9713f
//          seqno:   -1
//          safe_to_bootstrap: 1 - IF PRIMARY NODE

//mkdir -p /run/mysqld/
//chown -R mysql:mysql /run/mysqld/
// mysqld -umysql --wsrep-new-cluster

}

