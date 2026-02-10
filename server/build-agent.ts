import { streamChat, generateCompletion } from "./ai-providers";

export interface BuildProject {
  id: string;
  userId: string;
  name: string;
  description: string;
  files: Record<string, string>;
  createdAt: string;
  updatedAt: string;
  deployed: boolean;
  deployedAt?: string;
  domain?: string;
  githubRepo?: string;
  messages: BuildMessage[];
  previewSlug: string;
}

export interface BuildMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  createdAt: string;
  files?: Record<string, string>;
}

export interface DomainRequest {
  id: string;
  userId: string;
  userName: string;
  userEmail: string;
  domain: string;
  status: "pending" | "approved" | "rejected" | "completed";
  paypalTransactionId?: string;
  createdAt: string;
  notes?: string;
}

export interface SupportMessage {
  id: string;
  userId: string;
  userName: string;
  userEmail: string;
  subject: string;
  message: string;
  status: "open" | "in_progress" | "resolved" | "closed";
  adminReply?: string;
  createdAt: string;
  updatedAt: string;
}

export interface AdminNotification {
  id: string;
  type: "domain_purchase" | "support_message" | "credit_purchase" | "deploy" | "signup";
  title: string;
  message: string;
  userId: string;
  userName: string;
  read: boolean;
  createdAt: string;
  metadata?: Record<string, any>;
}

const projects = new Map<string, BuildProject>();
const slugIndex = new Map<string, string>();
const domainRequests = new Map<string, DomainRequest>();
const supportMessages = new Map<string, SupportMessage>();
const adminNotifications: AdminNotification[] = [];
const githubTokens = new Map<string, string>();

function genId(): string {
  return Date.now().toString(36) + Math.random().toString(36).substr(2, 9);
}

function generateSlug(name: string): string {
  let slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  if (!slug) slug = "project";
  if (slug.length > 30) slug = slug.substring(0, 30).replace(/-$/, "");
  let finalSlug = slug;
  let counter = 1;
  while (slugIndex.has(finalSlug)) {
    finalSlug = `${slug}-${counter}`;
    counter++;
  }
  return finalSlug;
}

export function addAdminNotification(notification: Omit<AdminNotification, "id" | "read" | "createdAt">) {
  const n: AdminNotification = {
    ...notification,
    id: genId(),
    read: false,
    createdAt: new Date().toISOString(),
  };
  adminNotifications.unshift(n);
  if (adminNotifications.length > 500) adminNotifications.pop();
  return n;
}

export function getAdminNotifications(limit = 50): AdminNotification[] {
  return adminNotifications.slice(0, limit);
}

export function markNotificationRead(id: string): boolean {
  const n = adminNotifications.find(x => x.id === id);
  if (n) { n.read = true; return true; }
  return false;
}

export function markAllNotificationsRead(): void {
  adminNotifications.forEach(n => { n.read = true; });
}

export function getUnreadNotificationCount(): number {
  return adminNotifications.filter(n => !n.read).length;
}

export function createProject(userId: string, name: string, description: string): BuildProject {
  const slug = generateSlug(name);
  const project: BuildProject = {
    id: genId(),
    userId,
    name,
    description,
    files: {},
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    deployed: false,
    messages: [],
    previewSlug: slug,
  };
  projects.set(project.id, project);
  slugIndex.set(slug, project.id);
  console.log(`[BUILD] Created project ${project.id} (slug: ${slug}) for user ${userId}. Total projects: ${projects.size}`);
  return project;
}

export function getProjects(userId: string): BuildProject[] {
  return Array.from(projects.values()).filter(p => p.userId === userId);
}

export function getProject(projectId: string): BuildProject | undefined {
  const p = projects.get(projectId);
  console.log(`[BUILD] getProject(${projectId}): ${p ? 'FOUND' : 'NOT FOUND'}. Map has ${projects.size} entries: [${Array.from(projects.keys()).join(', ')}]`);
  return p;
}

export function getProjectBySlug(slug: string): BuildProject | undefined {
  const projectId = slugIndex.get(slug);
  if (!projectId) return undefined;
  return projects.get(projectId);
}

export function updateProjectFiles(projectId: string, files: Record<string, string>): BuildProject | undefined {
  const project = projects.get(projectId);
  if (!project) return undefined;
  project.files = { ...project.files, ...files };
  project.updatedAt = new Date().toISOString();
  return project;
}

export function deleteProject(projectId: string): boolean {
  const project = projects.get(projectId);
  if (project) slugIndex.delete(project.previewSlug);
  return projects.delete(projectId);
}

export function addMessageToProject(projectId: string, msg: BuildMessage): BuildProject | undefined {
  const project = projects.get(projectId);
  if (!project) return undefined;
  project.messages.push(msg);
  project.updatedAt = new Date().toISOString();
  return project;
}

const BUILD_SYSTEM_PROMPT = `You are CFGPT Build Agent, an advanced AI website and app builder. You create production-quality, fully-featured websites and web applications.

CRITICAL: When the user asks you to build something, you MUST respond with COMPLETE, WORKING code files using this exact format:

\`\`\`filename:index.html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Page Title</title>
  <link rel="stylesheet" href="styles.css">
</head>
<body>
  <!-- Full HTML content here -->
  <script src="script.js"></script>
</body>
</html>
\`\`\`

\`\`\`filename:styles.css
/* Complete CSS with all styles */
\`\`\`

\`\`\`filename:script.js
// Complete JavaScript with all functionality
\`\`\`

WEBSITE BUILDING RULES:
1. ALWAYS generate SEPARATE files: index.html, styles.css, script.js (minimum). NEVER put CSS or JS inline in HTML unless absolutely necessary.
2. ALWAYS generate COMPLETE files - never use placeholders, "...", or "add more here". Every file must be fully working.
3. CSS must be comprehensive: layout, typography, colors, spacing, hover effects, transitions, animations, responsive breakpoints (@media queries for mobile/tablet/desktop).
4. Use modern CSS: flexbox, grid, CSS custom properties (variables), clamp(), smooth transitions, box-shadow, backdrop-filter, gradients.
5. JavaScript must be fully functional: event listeners, DOM manipulation, form validation, smooth scrolling, animations, mobile menu toggle, modals.
6. Responsive design is MANDATORY: mobile-first approach, hamburger menu for mobile, flexible grids, fluid typography.
7. Professional design quality: consistent color scheme, proper spacing (padding/margin), readable typography, visual hierarchy, call-to-action buttons, professional imagery using placeholder services (picsum.photos, placehold.co, unsplash source URLs).
8. For multi-page sites, create separate HTML files (index.html, about.html, contact.html, etc.) each with full content.
9. When user provides or mentions images, reference them properly in the code. If they upload images, use the provided image URLs/paths.
10. For forms: include full HTML form structure, CSS styling, and JS validation with user feedback.
11. Include proper SEO: meta tags, semantic HTML (header, nav, main, section, footer, article), alt attributes on images.
12. When modifying existing files, output the COMPLETE updated file - never partial updates.
13. If the user's request is vague, build something impressive with smart defaults.
14. For e-commerce sites: product grids, shopping cart UI, checkout flow, product detail pages.
15. For portfolios: hero section, project gallery, about section, contact form, social links.
16. For landing pages: hero with CTA, features section, testimonials, pricing, FAQ, footer.

IMAGE HANDLING:
- If user uploads an image and asks to include it, reference it in the HTML/CSS.
- For placeholder images, use: https://picsum.photos/WIDTH/HEIGHT or https://placehold.co/WIDTHxHEIGHT
- For icons, use Font Awesome CDN, Google Material Icons, or inline SVG.

You can build: Complete websites, landing pages, portfolios, e-commerce stores, dashboards, blogs, SaaS pages, restaurant sites, business sites, personal sites, web apps, admin panels, forms, and anything else the user wants.

Always explain what you built and suggest improvements they could ask for next.`;

export async function* streamBuildAgent(
  projectId: string,
  userMessage: string,
  existingFiles: Record<string, string>
) {
  const project = projects.get(projectId);
  const history = project?.messages || [];

  const contextMessages = [];

  if (Object.keys(existingFiles).length > 0) {
    const fileList = Object.entries(existingFiles)
      .map(([name, content]) => `--- ${name} ---\n${content}`)
      .join("\n\n");
    contextMessages.push({
      role: "system" as const,
      content: `Current project files:\n${fileList}`,
    });
  }

  const recentHistory = history.slice(-10).map(m => ({
    role: m.role as "user" | "assistant",
    content: m.content,
  }));

  contextMessages.push(...recentHistory);
  contextMessages.push({ role: "user" as const, content: userMessage });

  const stream = await streamChat(contextMessages, BUILD_SYSTEM_PROMPT);

  for await (const chunk of stream) {
    const content = chunk.choices[0]?.delta?.content || "";
    if (content) {
      yield content;
    }
  }
}

export function parseFilesFromResponse(response: string): Record<string, string> {
  const files: Record<string, string> = {};
  const regex = /```filename:([^\n]+)\n([\s\S]*?)```/g;
  let match;
  while ((match = regex.exec(response)) !== null) {
    const filename = match[1].trim();
    const content = match[2].trim();
    if (filename && content) {
      files[filename] = content;
    }
  }
  return files;
}

export function createDomainRequest(
  userId: string,
  userName: string,
  userEmail: string,
  domain: string,
  paypalTransactionId?: string
): DomainRequest {
  const req: DomainRequest = {
    id: genId(),
    userId,
    userName,
    userEmail,
    domain,
    status: "pending",
    paypalTransactionId,
    createdAt: new Date().toISOString(),
  };
  domainRequests.set(req.id, req);

  addAdminNotification({
    type: "domain_purchase",
    title: "New Domain Purchase Request",
    message: `${userName} (${userEmail}) requested domain: ${domain}${paypalTransactionId ? ` - PayPal TX: ${paypalTransactionId}` : ""}`,
    userId,
    userName,
    metadata: { domain, paypalTransactionId, requestId: req.id },
  });

  return req;
}

export function getDomainRequests(userId?: string): DomainRequest[] {
  const all = Array.from(domainRequests.values());
  if (userId) return all.filter(r => r.userId === userId);
  return all;
}

export function updateDomainRequest(id: string, updates: Partial<DomainRequest>): DomainRequest | undefined {
  const req = domainRequests.get(id);
  if (!req) return undefined;
  Object.assign(req, updates);
  return req;
}

export function createSupportMessage(
  userId: string,
  userName: string,
  userEmail: string,
  subject: string,
  message: string
): SupportMessage {
  const msg: SupportMessage = {
    id: genId(),
    userId,
    userName,
    userEmail,
    subject,
    message,
    status: "open",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  supportMessages.set(msg.id, msg);

  addAdminNotification({
    type: "support_message",
    title: "New Support Message",
    message: `${userName}: ${subject} - "${message.substring(0, 100)}${message.length > 100 ? "..." : ""}"`,
    userId,
    userName,
    metadata: { subject, messageId: msg.id },
  });

  return msg;
}

export function getSupportMessages(userId?: string): SupportMessage[] {
  const all = Array.from(supportMessages.values());
  if (userId) return all.filter(m => m.userId === userId);
  return all.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}

export function updateSupportMessage(id: string, updates: Partial<SupportMessage>): SupportMessage | undefined {
  const msg = supportMessages.get(id);
  if (!msg) return undefined;
  Object.assign(msg, updates, { updatedAt: new Date().toISOString() });
  return msg;
}

export function setGithubToken(userId: string, token: string): void {
  githubTokens.set(userId, token);
}

export function getGithubToken(userId: string): string | undefined {
  return githubTokens.get(userId);
}

export function removeGithubToken(userId: string): void {
  githubTokens.delete(userId);
}

export async function pushToGithub(
  userId: string,
  repoName: string,
  files: Record<string, string>,
  commitMessage: string = "Build from CFGPT"
): Promise<{ success: boolean; url?: string; error?: string }> {
  const token = githubTokens.get(userId);
  if (!token) return { success: false, error: "GitHub not connected. Please add your GitHub token." };

  try {
    const userRes = await fetch("https://api.github.com/user", {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github.v3+json" },
    });
    if (!userRes.ok) return { success: false, error: "Invalid GitHub token" };
    const githubUser = await userRes.json() as { login: string };

    let repoUrl = `https://api.github.com/repos/${githubUser.login}/${repoName}`;
    const repoCheck = await fetch(repoUrl, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github.v3+json" },
    });

    if (!repoCheck.ok) {
      const createRes = await fetch("https://api.github.com/user/repos", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github.v3+json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ name: repoName, private: false, auto_init: true }),
      });
      if (!createRes.ok) {
        const err = await createRes.text();
        return { success: false, error: `Failed to create repo: ${err}` };
      }
      await new Promise(resolve => setTimeout(resolve, 2000));
    }

    for (const [filepath, content] of Object.entries(files)) {
      const encodedContent = Buffer.from(content).toString("base64");

      const existingFile = await fetch(
        `https://api.github.com/repos/${githubUser.login}/${repoName}/contents/${filepath}`,
        { headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github.v3+json" } }
      );

      const body: any = {
        message: `${commitMessage}: ${filepath}`,
        content: encodedContent,
      };

      if (existingFile.ok) {
        const existing = await existingFile.json() as { sha: string };
        body.sha = existing.sha;
      }

      const putRes = await fetch(
        `https://api.github.com/repos/${githubUser.login}/${repoName}/contents/${filepath}`,
        {
          method: "PUT",
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: "application/vnd.github.v3+json",
            "Content-Type": "application/json",
          },
          body: JSON.stringify(body),
        }
      );

      if (!putRes.ok) {
        const err = await putRes.text();
        return { success: false, error: `Failed to push ${filepath}: ${err}` };
      }
    }

    return { success: true, url: `https://github.com/${githubUser.login}/${repoName}` };
  } catch (error: any) {
    return { success: false, error: error.message || "GitHub push failed" };
  }
}

export function deployProject(projectId: string, domain?: string): BuildProject | undefined {
  const project = projects.get(projectId);
  if (!project) return undefined;
  project.deployed = true;
  project.deployedAt = new Date().toISOString();
  if (domain) project.domain = domain;
  project.updatedAt = new Date().toISOString();

  addAdminNotification({
    type: "deploy",
    title: "Project Deployed",
    message: `User deployed project "${project.name}"${domain ? ` with domain ${domain}` : ""}`,
    userId: project.userId,
    userName: project.userId,
    metadata: { projectId, projectName: project.name, domain },
  });

  return project;
}
