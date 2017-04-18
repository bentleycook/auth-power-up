const bodyParser = require('body-parser');
const compression = require('compression');
const cors = require('cors');
const express = require('express');
const rp = require('request-promise');

Promise = require('bluebird');

const app = express();

// compress our client side content before sending it over the wire
app.use(compression());

// your manifest must have appropriate CORS headers, you could also use '*'
app.use(cors({ origin: '*' }));

// http://expressjs.com/en/starter/static-files.html
app.use(express.static('public'));

// helps us parse the body of POST requests to set snoozes
app.use(bodyParser.urlencoded({ extended: false }));

// Setup server routes
// require('./routes.js')(app);

// listen for requests :)
const listener = app.listen(process.env.PORT, () => {
  console.log('Server up and running 🏃');
});