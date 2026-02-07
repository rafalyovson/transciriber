#!/bin/bash
cd ~/Developer/transcriber || exit
osascript -e 'tell application "Terminal" to do script "cd ~/Developer/transcriber && deno task start:ui"'
sleep 2
open "http://localhost:8000"
