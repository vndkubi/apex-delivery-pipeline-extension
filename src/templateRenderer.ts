import * as fs from 'fs';
import * as path from 'path';
import { resolveTemplateRefPath } from './templateRef';

export interface TemplateContext {
  epicKey: string;
  title: string;
  owner: string;
  date: string;
}

export function renderTemplate(content: string, context: TemplateContext): string {
  return content
    .replaceAll('{{EPIC_KEY}}', context.epicKey)
    .replaceAll('{{TITLE}}', context.title)
    .replaceAll('{{OWNER}}', context.owner)
    .replaceAll('{{DATE}}', context.date);
}

export function writeFromTemplate(
  workspaceRoot: string,
  templateRoot: string,
  templateRef: string,
  targetPath: string,
  context: TemplateContext,
): void {
  const templatePath = resolveTemplateRefPath(workspaceRoot, templateRoot, templateRef);
  const raw = templatePath && fs.existsSync(templatePath)
    ? fs.readFileSync(templatePath, 'utf8')
    : fallbackTemplate(path.basename(templateRef), context);

  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.writeFileSync(targetPath, renderTemplate(raw, context), 'utf8');
}

function fallbackTemplate(templateName: string, context: TemplateContext): string {
  return `# ${templateName} - ${context.epicKey}\n\nCreated: ${context.date}\nOwner: ${context.owner}\n`;
}
