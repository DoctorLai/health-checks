const axios = require('axios');
const nodemailer = require('nodemailer');
const config = require('./config.json');

// email queues
emails_to_send = [];
last_handled = {};
config.urls.forEach(urlConfig => {
  last_handled[urlConfig.url] = urlConfig;
});
console.log("--------------- last_handled -----------------");
console.log(last_handled);
console.log("--------------- ------------ -----------------");

// Create a nodemailer transport
const transporter = nodemailer.createTransport({
  service: config.email.service,
  auth: {
    user: config.email.auth.user,
    pass: config.email.auth.pass
  }
});
 
// Loop through each URL in the config file
config.urls.forEach(urlConfig => {
  setInterval(() => {
    // Make a GET request to the URL
    console.log(`${new Date().toISOString()}: Checking ${urlConfig.url} ...`);
    axios.get(urlConfig.url, {
        responseType: 'text',
        transformResponse: [v => v]
      })
      .then(response => {
        // Check if the status code and response body match the expected values
        if (response.status !== urlConfig.expectedStatusCode) {
          const errorMessage = `${urlConfig.name} returned unexpected status code: ${response.status}`;
          console.error(errorMessage);
          pushEmail(urlConfig.url, urlConfig.name, errorMessage);
          return;
        }
        let res = response.data;
        if (urlConfig.expectedContent && (!res.includes(urlConfig.expectedContent))) {
          const errorMessage = `${urlConfig.name} returned unexpected content: ${res}`;
          console.error(errorMessage);
          pushEmail(urlConfig.url, urlConfig.name, errorMessage);
          return;
        }
        console.log(`${urlConfig.url} - OK!`);
      })
      .catch(error => {
        const errorMessage = `${urlConfig.name} could not be reached: ${error}`;
        console.error(errorMessage);
        pushEmail(urlConfig.url, urlConfig.name, errorMessage);
      });
  }, urlConfig.interval * 1000); // Convert interval from seconds to milliseconds
});
 
// Push to the email queue
function pushEmail(url, urlName, errorMessage) {
  const now = new Date();
  if (typeof last_handled[url]["lastUpdated"] !== "undefined") {
    const lastUpdated = last_handled[url]["lastUpdated"];
    let sec = Math.abs(lastUpdated - now) / 1000;
    if (sec <= last_handled[url]["ignore_period"]) {
      console.log(`Ignore error ${url} since last happens at ${sec} seconds ago.`);
      return;
    }
  }
  emails_to_send.push({
    subject: `Health check failed for ${urlName}`,
    text: errorMessage,
    datetime: now
  });
  // update the last error time
  last_handled[url]["lastUpdated"] = now;
}

function sendEmail(subject, text) {
  const mailOptions = {
    from: config.email.auth.user,
    to: config.email.destination,
    subject: subject,
    text: text
  };
  
  transporter.sendMail(mailOptions, (error) => {
    if (error) {
      console.error(`Failed to send email notification: ${error}`);
    } else {
      console.log(`Email notification sent for ${subject}`);
    }
  });
}

function printEmail(subject, text) {
  console.log(`Notification of Failure Handled: subject=${subject}, text=${text}`);
}

setInterval(() => {
  if (emails_to_send.length === 0) {
    // console.log("No Failures Unhandled.");
    return;
  }
  const item = emails_to_send.shift();
  if (config.email.enabled) {
    sendEmail(item.subject, item.text);
  } else {
    printEmail(item.subject, item.text);
  }
}, config.email.interval * 1000);
