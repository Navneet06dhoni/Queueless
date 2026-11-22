import fs from 'fs';
import path from 'path';
import { generateOpenApiSpec } from '../src/docs/openapi';

const exportDocs = () => {
  const spec = generateOpenApiSpec();
  const docsDir = path.resolve(__dirname, '../../docs');

  if (!fs.existsSync(docsDir)) {
    fs.mkdirSync(docsDir, { recursive: true });
  }

  const outputPath = path.join(docsDir, 'openapi.json');
  fs.writeFileSync(outputPath, JSON.stringify(spec, null, 2), 'utf-8');
  console.log(`✅ OpenAPI 3.0 spec successfully exported to ${outputPath}`);
};

exportDocs();
