'use strict';
const request = require('request');
const config = require('./config');
const mysql = require('mysql');


var db_config = {
    host: config.DB_HOST,
    user: config.DB_USER,
    password: config.DB_PASSWORD,
    database: config.DB_DATABASE
};

// // First you need to create a connection to the db
// var connection = mysql.createConnection(db_config);

// connection.connect(function(err){
//   if(err){
//     console.log('Error connecting to Db');
//     return;
//   }
//   console.log('Connection established');
// });

var connection;

function handleDisconnect() {
    console.log('1. connecting to db:');
    connection = mysql.createConnection(db_config); // Recreate connection

    connection.connect(function(err) { // The server is either down or restarting
        if (err) {
            console.log('2. error when connecting to db:', err);
            setTimeout(handleDisconnect, 1000); //In case of error, delay before reattempting
        }
    });
    connection.on('error', function(err) {
        console.log('3. db error', err);
        if (err.code === 'PROTOCOL_CONNECTION_LOST') {  // If connection lost, reconnect
            handleDisconnect();
        } else {
            throw err;
        }
    });
    return connection
}

handleDisconnect();

// function endConnection(){
//     connection.end(function(err) {
//       // The connection is terminated gracefully
//       // Ensures all previously enqueued queries are still
//       // before sending a COM_QUIT packet to the MySQL server.
//     });
// }


function userData(callback, userId) {
    request({
        uri: 'https://graph.facebook.com/v2.7/' + userId,
        qs: {
            access_token: config.FB_PAGE_TOKEN
        }

    }, function (error, response, body) {
        var firstTimeUser = false
        if (!error && response.statusCode == 200) {

            var user = JSON.parse(body);

            if (user.first_name) {
                // console.log("FB user: %s %s, %s",
                //     user.first_name, user.last_name, user.gender);

                connection.query(`SELECT id FROM users WHERE fb_id = '${userId}' LIMIT 1`, function(err, rows, fields) {
                    if (err) {
                        // console.log('error: ', err);
                        throw err;
                    }
                    if (rows.length === 0){

                        var sql = {fb_id: userId, first_name: user.first_name, last_name: user.last_name, profile_pic: user.profile_pic, locale: user.locale, timezone: user.timezone, gender: user.gender};

                        connection.query('INSERT INTO users SET ?', sql, function(err,res){
                          if(err) throw err;
                        });
                    }
                });
                callback(user);
            } else {
                // console.log("Cannot get data for fb user with id",
                //     userId);
            }
        } else {
            console.error(response.error);
        }

    });
}


module.exports = {
    userData: userData
}