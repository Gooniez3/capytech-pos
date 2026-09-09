const os = require('os');

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);
const ALLOWED_PORTS = new Set(['', '80', '443', '3000', '4000', '5173']);

function isIPv4Interface(address) {
  return address.family === 'IPv4' || address.family === 4;
}

function isPrivateIPv4(host) {
  if (/^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host)) return true;
  if (/^192\.168\.\d{1,3}\.\d{1,3}$/.test(host)) return true;
  const match = /^172\.(\d{1,3})\.\d{1,3}\.\d{1,3}$/.exec(host);
  if (!match) return false;
  const second = Number(match[1]);
  return second >= 16 && second <= 31;
}

function getLanIPv4() {
  const addresses = [];

  for (const entries of Object.values(os.networkInterfaces())) {
    for (const entry of entries || []) {
      if (entry.internal || !isIPv4Interface(entry)) continue;
      if (entry.address.startsWith('169.254.')) continue;
      addresses.push(entry.address);
    }
  }

  return (
    addresses.find((address) => address.startsWith('192.168.')) ||
    addresses.find((address) => isPrivateIPv4(address)) ||
    null
  );
}

function isAllowedLocalOrigin(origin) {
  if (!origin) return true;

  let url;
  try {
    url = new URL(origin);
  } catch {
    return false;
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return false;
  }

  if (!ALLOWED_PORTS.has(url.port)) {
    return false;
  }

  return LOOPBACK_HOSTS.has(url.hostname) || isPrivateIPv4(url.hostname);
}

module.exports = {
  getLanIPv4,
  isAllowedLocalOrigin,
  isPrivateIPv4,
};
