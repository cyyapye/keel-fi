#!/bin/sh
set -eu

namespace=${KEEL_AGENT_NETWORK_NAMESPACE:-keel-agents}
host_interface=${KEEL_AGENT_HOST_INTERFACE:-keel-agent0}
namespace_interface=${KEEL_AGENT_NAMESPACE_INTERFACE:-eth0}
external_interface=${KEEL_AGENT_EXTERNAL_INTERFACE:-ens3}
namespace_source=${KEEL_AGENT_NAMESPACE_SOURCE:-10.203.0.2/32}

# Cloudflare Tunnel publishes these IPv4 endpoints for region1 and region2.
# The agent namespace has IPv6 disabled, so no IPv6 rules are installed.
cloudflare_tunnel_endpoints='
198.41.192.167
198.41.192.67
198.41.192.57
198.41.192.107
198.41.192.27
198.41.192.7
198.41.192.227
198.41.192.47
198.41.192.37
198.41.192.77
198.41.200.13
198.41.200.193
198.41.200.33
198.41.200.233
198.41.200.53
198.41.200.63
198.41.200.113
198.41.200.73
198.41.200.43
198.41.200.23
'

require_root() {
    if [ "$(/usr/bin/id -u)" != 0 ]; then
        /usr/bin/printf 'Run this command as root.\n' >&2
        exit 1
    fi
}

namespace_exists() {
    /usr/sbin/ip netns list | /usr/bin/awk '{print $1}' | \
        /usr/bin/grep -Fxq "$namespace"
}

host_rule_exists() {
    endpoint=$1
    protocol=$2
    /usr/sbin/iptables -C ufw-before-forward \
        -i "$host_interface" -s "$namespace_source" \
        -o "$external_interface" -d "$endpoint/32" \
        -p "$protocol" --dport 7844 -j ACCEPT >/dev/null 2>&1
}

namespace_rule_exists() {
    endpoint=$1
    protocol=$2
    /usr/sbin/ip netns exec "$namespace" /usr/sbin/iptables -C OUTPUT \
        -o "$namespace_interface" -d "$endpoint/32" \
        -p "$protocol" --dport 7844 -j ACCEPT >/dev/null 2>&1
}

ensure_host_rules() {
    for endpoint in $cloudflare_tunnel_endpoints; do
        for protocol in tcp udp; do
            if ! host_rule_exists "$endpoint" "$protocol"; then
                /usr/sbin/iptables -I ufw-before-forward 1 \
                    -i "$host_interface" -s "$namespace_source" \
                    -o "$external_interface" -d "$endpoint/32" \
                    -p "$protocol" --dport 7844 -j ACCEPT
            fi
        done
    done
}

ensure_namespace_rules() {
    if ! namespace_exists; then
        /usr/bin/printf 'Missing network namespace: %s\n' "$namespace" >&2
        exit 1
    fi
    for endpoint in $cloudflare_tunnel_endpoints; do
        for protocol in tcp udp; do
            if ! namespace_rule_exists "$endpoint" "$protocol"; then
                /usr/sbin/ip netns exec "$namespace" \
                    /usr/sbin/iptables -I OUTPUT 1 \
                    -o "$namespace_interface" -d "$endpoint/32" \
                    -p "$protocol" --dport 7844 -j ACCEPT
            fi
        done
    done
}

verify_rules() {
    if ! namespace_exists; then
        /usr/bin/printf 'Missing network namespace: %s\n' "$namespace" >&2
        exit 1
    fi
    for endpoint in $cloudflare_tunnel_endpoints; do
        for protocol in tcp udp; do
            host_rule_exists "$endpoint" "$protocol"
            namespace_rule_exists "$endpoint" "$protocol"
        done
    done
}

remove_namespace_rules() {
    if ! namespace_exists; then
        return
    fi
    for endpoint in $cloudflare_tunnel_endpoints; do
        for protocol in tcp udp; do
            while namespace_rule_exists "$endpoint" "$protocol"; do
                /usr/sbin/ip netns exec "$namespace" \
                    /usr/sbin/iptables -D OUTPUT \
                    -o "$namespace_interface" -d "$endpoint/32" \
                    -p "$protocol" --dport 7844 -j ACCEPT
            done
        done
    done
}

remove_host_rules() {
    for endpoint in $cloudflare_tunnel_endpoints; do
        for protocol in tcp udp; do
            while host_rule_exists "$endpoint" "$protocol"; do
                /usr/sbin/iptables -D ufw-before-forward \
                    -i "$host_interface" -s "$namespace_source" \
                    -o "$external_interface" -d "$endpoint/32" \
                    -p "$protocol" --dport 7844 -j ACCEPT
            done
        done
    done
}

require_root
case "${1:-}" in
    host-start)
        ensure_host_rules
        ;;
    namespace-start)
        ensure_namespace_rules
        ;;
    start)
        ensure_host_rules
        ensure_namespace_rules
        verify_rules
        ;;
    verify)
        verify_rules
        ;;
    stop)
        remove_namespace_rules
        remove_host_rules
        ;;
    *)
        /usr/bin/printf 'Usage: %s host-start|namespace-start|start|verify|stop\n' "$0" >&2
        exit 2
        ;;
esac
