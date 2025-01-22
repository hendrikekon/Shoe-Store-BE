const mongoose = require('mongoose');
const {dbHost, dbName, dbPort, dbUser, dbPass} = require('../app/config')

// mongoose.connect(`mongodb://${dbUser}:${dbPass}@${dbHost}:${dbPort}/${dbName}?authSource=admin`);
// const db = mongoose.connection;

// module.exports = db;

mongoose.connect(`mongodb+srv://${dbUser}:${dbPass}@cluster0.lh18l.mongodb.net/${dbName}?retryWrites=true&w=majority&appName=Cluster0`);
const db = mongoose.connection;

module.exports = db;