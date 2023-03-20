# health-checks
A Simple Health Check Tool

## Background
CloudFlare provides Health Checks but you have to be on a paid plan. [Vultr](https://helloacm.com/out/vultr) provides Free-Tier VPS (512 MB, 1 Core, 10 GB SSD, 2 TB Bandwidth).

This lightweight VPS does not have much RAM - so it cannot run heavy applications, but this (health check) tool should be a good use case for it.

## Acknowledgement
Most code at the "init commit" is done by [ChatGPT](https://helloacm.com/chatgpt-designs-a-health-check-tool-in-node-js-to-run-on-free-vps-instance/). Thank you!

## How to Run?
No docker - as you probably can't run docker on it. You can either run it in `screen` or `pm2` (install via `npm install pm2 -g`) so that it will stay in background.

### Config.json
Change `config.json.sample` to `config.json` and modify the content necessary - which should be pretty straightforward.

Run `npm install` to install the missing dependencies.

### Run Health-Checks
Simply Run `node health-checks.js`,

Example:

![image](https://user-images.githubusercontent.com/1764434/226456987-049768c5-f00d-4bd8-9829-7455de428a77.png)

In case of failures:

![d59cb84041082bcf257cadacf9f434d](https://user-images.githubusercontent.com/1764434/226457048-a378637f-9cba-4d5e-a830-4ec05330207b.png)

You should get an email, if configured correctedly.

![efcef2260e1f5815890b0035ecfcba7](https://user-images.githubusercontent.com/1764434/226457115-dcf56438-f820-4df8-868f-a4454aacdb6e.png)

## TODO:
Configure a max email per period (PR welcome)

## Support
If you find this useful, [why not buy me a coffee](https://justyy.com/out/bmc)? Thanks!
