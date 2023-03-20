#!/bin/bash

pm2 delete health-check.js
pm2 start health-check.js --max-memory-restart 200M