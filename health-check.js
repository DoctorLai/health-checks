const axios = require('axios');
const nodemailer = require('nodemailer');
const config = require('./config.json');
 
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
    axios.get(urlConfig.url)
      .then(response => {
        // Check if the status code and response body match the expected values
        if (response.status !== urlConfig.expectedStatusCode) {
          const errorMessage = `${urlConfig.name} returned unexpected status code: ${response.status}`;
          console.error(errorMessage);
          sendEmail(urlConfig.name, errorMessage);
          return;
        }
        if (response.data && (!response.data.includes(urlConfig.expectedContent))) {
          const errorMessage = `${urlConfig.name} returned unexpected content`;
          console.error(errorMessage);
          sendEmail(urlConfig.name, errorMessage);
          return;
        }
        console.log(`${urlConfig.url} - OK!`);
      })
      .catch(error => {
        const errorMessage = `${urlConfig.name} could not be reached: ${error}`;
        console.error(errorMessage);
        sendEmail(urlConfig.name, errorMessage);
      });
  }, urlConfig.interval * 1000); // Convert interval from seconds to milliseconds
});
 
// Function to send email notification
function sendEmail(urlName, errorMessage) {
  const mailOptions = {
    from: config.email.auth.user,
    to: config.email.destination,
    subject: `Health check failed for ${urlName}`,
    text: errorMessage
  };
  
  transporter.sendMail(mailOptions, (error, info) => {
    if (error) {
      console.error(`Failed to send email notification: ${error}`);
    } else {
      console.log(`Email notification sent for ${urlName}`);
    }
  });
}