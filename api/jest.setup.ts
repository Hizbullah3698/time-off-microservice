// Verify mock HCM is reachable before integration tests
import axios from 'axios';

export default async function globalSetup() {
  try {
    await axios.get('http://localhost:4000/admin/state');
  } catch {
    throw new Error(
      'Mock HCM server is not running on port 4000. ' +
        'Start it with: cd mock-hcm && npm start',
    );
  }
}
