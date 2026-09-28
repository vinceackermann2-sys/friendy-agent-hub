#!/bin/sh
set -eu
# Dedicated host only. A debugging pipe avoids opening an unauthenticated CDP port.
id -u belna-checkout >/dev/null
iptables -N BELNA_CHECKOUT 2>/dev/null || true
iptables -F BELNA_CHECKOUT
iptables -A BELNA_CHECKOUT -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT
# The host resolver is the only private service accessible by this UID.
iptables -A BELNA_CHECKOUT -d 127.0.0.53 -p udp --dport 53 -j ACCEPT
iptables -A BELNA_CHECKOUT -d 127.0.0.53 -p tcp --dport 53 -j ACCEPT
for net in 0.0.0.0/8 10.0.0.0/8 100.64.0.0/10 127.0.0.0/8 169.254.0.0/16 172.16.0.0/12 192.0.0.0/24 192.0.2.0/24 192.168.0.0/16 198.18.0.0/15 198.51.100.0/24 203.0.113.0/24 224.0.0.0/4 240.0.0.0/4 168.63.129.16/32; do
 iptables -A BELNA_CHECKOUT -d "$net" -j REJECT
done
iptables -A BELNA_CHECKOUT -p tcp -m multiport --dports 80,443 -j ACCEPT
iptables -A BELNA_CHECKOUT -j REJECT
iptables -C OUTPUT -m owner --uid-owner belna-checkout -j BELNA_CHECKOUT 2>/dev/null || iptables -I OUTPUT -m owner --uid-owner belna-checkout -j BELNA_CHECKOUT
ip6tables -C OUTPUT -m owner --uid-owner belna-checkout -j REJECT 2>/dev/null || ip6tables -I OUTPUT -m owner --uid-owner belna-checkout -j REJECT
install -d -m 755 -o root -g root /run/belna-checkout
printf 'enabled\n' > /run/belna-checkout/network-guard
chown root:root /run/belna-checkout/network-guard
chmod 644 /run/belna-checkout/network-guard
