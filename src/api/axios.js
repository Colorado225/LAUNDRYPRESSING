import axios from 'axios';
import toast from 'react-hot-toast';

const API = axios.create({
  // Backend URL from environment variables
  baseURL: import.meta.env.VITE_API_BASE_URL || 'http://localhost:5000/api',
});

// REQUEST INTERCEPTOR: Attaches the token
API.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// RESPONSE INTERCEPTOR: Handles global feedback
API.interceptors.response.use(
  (response) => {
    // Optional: You can toast success messages here if your backend 
    // sends a "message" field on successful POST/PUT/DELETE requests.
    return response;
  },
  (error) => {
    // 1. Extract the message from the backend error or use a fallback
    const message = error.response?.data?.message ||
      (error.code === 'ERR_NETWORK'
        ? 'Network error: check that the backend is running and the API URL is correct.'
        : 'A network error occurred');

    // 2. Handle specific status codes
    if (error.response?.status === 401) {
      // If unauthorized, clear local storage and perhaps redirect
      localStorage.removeItem('token');
      localStorage.removeItem('user');
      // We don't toast 401s usually because the ProtectedRoute will handle the jump to /login
    } else {
      // 3. Display the error toast for everything else (500, 400, 403, 404, etc.)
      toast.error(message, {
        id: 'global-api-error', // Prevents multiple popups if many requests fail at once
        style: {
          fontSize: '10px',
          fontWeight: '900',
          textTransform: 'uppercase',
          border: '1px solid #fee2e2'
        }
      });
    }

    return Promise.reject(error);
  }
);

export default API;