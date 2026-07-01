module.exports = {
  apps: [
    {
      name: 'taskverse-api',
      script: 'dist/main.js',
      instances: 'max',
      exec_mode: 'cluster',
      env_production: {
        NODE_ENV: 'production',
        PORT: 3001,
      },
      max_memory_restart: '500M',
      error_file: 'logs/err.log',
      out_file: 'logs/out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      // Graceful shutdown — wait for in-flight requests
      kill_timeout: 5000,
      listen_timeout: 10000,
      // Auto-restart on crash with exponential backoff
      exp_backoff_restart_delay: 100,
      max_restarts: 10,
    },
  ],
}
