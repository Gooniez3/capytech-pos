import axios from 'axios';

// Auto-detect the backend URL: whatever hostname the browser used to load this
// page (localhost on the PC, or the PC's local IP when opened from a phone),
// but always talk to the backend's port 4000. This means you don't need to
// hardcode an IP address anywhere.
const backendHost = window.location.hostname;
const API_URL = `http://${backendHost}:4000/api`;

const api = axios.create({
  baseURL: API_URL,
});

// Attach the saved JWT token to every request automatically
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('pos_token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

export default api;
