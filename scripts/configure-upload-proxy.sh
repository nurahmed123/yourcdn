#!/usr/bin/env bash
set -euo pipefail

# Extend this app's own HTTPS vhost; leave other sites and routes alone.
domain=$1
port=$2
[[ "$domain" =~ ^[a-zA-Z0-9.-]+$ && "$port" =~ ^[0-9]+$ ]]
site="/etc/nginx/sites-available/$domain"
if sudo grep -Fq '# YourCDN streaming upload' "$site"; then
  exit 0
fi
previous=$(mktemp)
updated=$(mktemp)
trap 'rm -f "$previous" "$updated"' EXIT
sudo cat "$site" > "$previous"
awk -v port="$port" '
  !found && /^[[:space:]]*location \/[[:space:]]*\{/ {
    print "    # YourCDN streaming upload"
    print "    location = /api/v1/upload {"
    print "        client_max_body_size 5120g;"
    print "        client_body_timeout 300s;"
    print "        proxy_request_buffering off;"
    print "        proxy_http_version 1.1;"
    print "        proxy_send_timeout 300s;"
    print "        proxy_read_timeout 300s;"
    print "        proxy_set_header Host $host;"
    print "        proxy_set_header X-Real-IP $remote_addr;"
    print "        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;"
    print "        proxy_set_header X-Forwarded-Proto $scheme;"
    print "        proxy_pass http://127.0.0.1:" port ";"
    print "    }"
    found = 1
  }
  { print }
  END { if (!found) exit 1 }
' "$previous" > "$updated"

sudo tee "$site" < "$updated" > /dev/null
if ! sudo nginx -t || ! sudo systemctl reload nginx; then
  sudo tee "$site" < "$previous" > /dev/null
  sudo nginx -t && sudo systemctl reload nginx
  exit 1
fi
