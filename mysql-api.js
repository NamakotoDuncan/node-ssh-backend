const mysql = require("mysql2/promise");

async function connectToDatabase(host,user,password) {
  try {
    const connection = await mysql.createConnection({
      host: host, //"172.16.0.235",
      user:user, // "_4e34275bedab93dc",
      password:password // "OE8llCeSwUypQAZW",
      // database: "_4e34275bedab93dc", // Add your database name here
    });

    // console.log("connected as id " + connection.threadId);

    // Example select query
    const [globalVariables, fieldsG] = await connection.execute("SHOW GLOBAL VARIABLES;"); 
    const [globalStatus, fieldsS] = await connection.execute("SHOW GLOBAL STATUS;"); 
    const [tableStatus, fieldsTS] = await connection.execute("SHOW TABLE STATUS FROM `information_schema`;"); 
    const [functionStatus, fieldsFs] = await connection.execute("SHOW FUNCTION STATUS WHERE `Db`='information_schema';"); 
    const [procedureStatus, fieldsPs] = await connection.execute("SHOW PROCEDURE STATUS WHERE `Db`='information_schema';"); 
    const [triggersStatus, fieldsTs] = await connection.execute("SHOW TRIGGERS FROM `information_schema`;"); 
    const [processList, fieldsPro] = await connection.execute("SELECT `ID`, `USER`, `HOST`, `DB`, `COMMAND`, `TIME`, `STATE`, LEFT(`INFO`, 51200) AS `Info`, `TIME_MS`, `STAGE`, `MAX_STAGE`, `PROGRESS`, `MEMORY_USED`, `MAX_MEMORY_USED`, `EXAMINED_ROWS`, `QUERY_ID`, `INFO_BINARY`, `TID` FROM `information_schema`.`PROCESSLIST`;"); 

    // console.log("Rows:", rows);
    return {globalVariables,globalStatus,tableStatus,functionStatus,procedureStatus,triggersStatus,processList};
  } catch (error) {
    console.error("error connecting: " + error.stack);
  }
}

// // connectToDatabase();
module.exports = connectToDatabase;
// aug 1 2022
// /**
//      SHOW TABLES FROM `information_schema`;
// SHOW DATABASES;
// SHOW VARIABLES;
// SHOW GLOBAL VARIABLES;---
// SELECT CONNECTION_ID();
// SHOW /*!50002 GLOBAL */ STATUS;---
// SELECT `DEFAULT_COLLATION_NAME` FROM `information_schema`.`SCHEMATA` WHERE `SCHEMA_NAME`='information_schema';
// SHOW TABLE STATUS FROM `information_schema`;--
// SHOW FUNCTION STATUS WHERE `Db`='information_schema';--
// SHOW PROCEDURE STATUS WHERE `Db`='information_schema';--
// SHOW TRIGGERS FROM `information_schema`;--
// SELECT *, EVENT_SCHEMA AS `Db`, EVENT_NAME AS `Name` FROM information_schema.`EVENTS` WHERE `EVENT_SCHEMA`='information_schema';--
// SELECT * FROM `information_schema`.`COLUMNS` WHERE TABLE_SCHEMA='information_schema' AND TABLE_NAME='PROCESSLIST' ORDER BY ORDINAL_POSITION;
// SELECT `ID`, `USER`, `HOST`, `DB`, `COMMAND`, `TIME`, `STATE`, LEFT(`INFO`, 51200) AS `Info`, `TIME_MS`, `STAGE`, `MAX_STAGE`, `PROGRESS`, `MEMORY_USED`, `MAX_MEMORY_USED`, `EXAMINED_ROWS`, `QUERY_ID`, `INFO_BINARY`, `TID` FROM `information_schema`.`PROCESSLIST`;--
// SHOW /*!50002 GLOBAL */ STATUS LIKE 'Com\_%';
// SELECT `ID`, `USER`, `HOST`, `DB`, `COMMAND`, `TIME`, `STATE`, LEFT(`INFO`, 51200) AS `Info`, `TIME_MS`, `STAGE`, `MAX_STAGE`, `PROGRESS`, `MEMORY_USED`, `MAX_MEMORY_USED`, `EXAMINED_ROWS`, `QUERY_ID`, `INFO_BINARY`, `TID` FROM `information_schema`.`PROCESSLIST`;--
//  */