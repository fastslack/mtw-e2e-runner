export default {
  baseUrl: 'http://host.docker.internal:3000',
  poolUrl: 'ws://localhost:3333',
  projectName: 'e2e-runner-hub',
  dashboardPort: 8484,
  
  // Enable hub mode for sync
  sync: {
    mode: 'hub',
    hub: {
      allowRegistration: true,
      requireApproval: false,
    },
  },
};
