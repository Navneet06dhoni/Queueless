import fs from 'fs';
import path from 'path';
import { generateOpenApiSpec } from '../src/docs/openapi';
import { getNotificationOpenApiSpec } from '../../services/notification-service/src/app';

const exportDocs = () => {
  const spec = generateOpenApiSpec();
  const notifSpec = getNotificationOpenApiSpec();

  // Merge paths from notification-service
  spec.paths = {
    ...spec.paths,
    ...notifSpec.paths,
  };

  const docsDir = path.resolve(__dirname, '../../docs');

  if (!fs.existsSync(docsDir)) {
    fs.mkdirSync(docsDir, { recursive: true });
  }

  const outputPath = path.join(docsDir, 'openapi.json');
  fs.writeFileSync(outputPath, JSON.stringify(spec, null, 2), 'utf-8');
  console.log(`✅ OpenAPI 3.0 spec successfully exported to ${outputPath}`);
};

exportDocs();
