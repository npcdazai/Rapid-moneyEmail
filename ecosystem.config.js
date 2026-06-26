module.exports = {
  apps: [
    {
      name: "rapidmoney-email",
      cwd: "/home/ubuntu/rapidMoney_Crm/Rapid-moneyEmail",
      script: "npm",
      args: "start",
      instances: 1,
      exec_mode: "fork",
      autorestart: true,
      watch: false,
      env: {
        NODE_ENV: "production",
        PORT: 3000
      }
    }
  ]
};