/* What the agent is doing right now, in words, for the chat header's status
   line. Every label comes from a real step in the run: the memory lookup,
   each model call, and each tool call described from its actual arguments.
   The model may add its own short `activity` note to a tool call
   ("Verifying your leads"); it is stripped before the tool runs. */

const ACTIVITY_PROP = {
  type: 'string',
  maxLength: 60,
  description: 'Optional. 2-6 word present-tense note shown to the user about what this call does for them, e.g. "Verifying your leads".',
};

const clip = (value, n = 40) => {
  const s = String(value || '').replace(/\s+/g, ' ').trim();
  return s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s;
};
const host = (url) => { try { return new URL(String(url)).hostname.replace(/^www\./, ''); } catch { return ''; } };
const quoted = (value) => (value ? ` “${clip(value)}”` : '');
const titleCase = (s) => String(s || '').toLowerCase().replace(/(^|[\s_-])\w/g, (m) => m.toUpperCase()).replace(/_/g, ' ');

const PAGE_ACTIONS = {
  click: 'Clicking on the page', click_text: 'Clicking on the page', double_click: 'Clicking on the page', right_click: 'Clicking on the page',
  hover: 'Pointing at the page', type: 'Typing on the page', key: 'Pressing a key', scroll: 'Scrolling the page', select: 'Choosing an option',
  drag: 'Dragging on the page', back: 'Going back a page', forward: 'Going forward a page', reload: 'Reloading the page', wait: 'Waiting for the page',
};
const SCREEN_ACTIONS = {
  screenshot: 'Looking at the screen', click: 'Clicking on the screen', double_click: 'Clicking on the screen', right_click: 'Clicking on the screen',
  move: 'Moving the pointer', drag: 'Dragging on the screen', type: 'Typing on the computer', key: 'Pressing a key', scroll: 'Scrolling the screen', wait: 'Waiting for the computer',
};

function describeTool(name, args = {}) {
  switch (name) {
    case 'web_search':
      if (args.query) return `Searching the web for${quoted(args.query)}`;
      return Array.isArray(args.urls) && host(args.urls[0]) ? `Reading ${host(args.urls[0])}` : 'Searching the web';
    case 'capability_search': return 'Finding the right tool';
    case 'memory_search': return `Checking memory${args.query ? ' for' + quoted(args.query) : ''}`;
    case 'memory_get': return 'Reading a memory';
    case 'memory_write': return 'Saving to memory';
    case 'memory_update': return 'Updating a memory';
    case 'memory_delete': return 'Removing a memory';
    case 'system_file_read': return 'Reading a system file';
    case 'system_file_update': return 'Updating a system file';
    case 'history_search': return `Searching past chats${args.query ? ' for' + quoted(args.query) : ''}`;
    case 'browser_open':
    case 'computer_screenshot': return host(args.url) ? `Opening ${host(args.url)}` : 'Opening a web page';
    case 'browser_action': return PAGE_ACTIONS[args.type] || 'Using the browser';
    case 'browser_submit': return clip(args.summary, 56) || 'Finishing on the website';
    case 'computer_action':
      if (args.action === 'open_app') return args.app === 'browser' && host(args.url) ? `Opening ${host(args.url)}` : `Opening the ${args.app || 'app'}`;
      return SCREEN_ACTIONS[args.action] || 'Using the computer';
    case 'computer_submit': return clip(args.summary, 56) || 'Finishing on the computer';
    case 'vault_list': return 'Checking your saved credentials';
    case 'vault_request': return 'Asking you to save a credential';
    case 'browser_fill_secret':
    case 'computer_fill_secret': return 'Filling in a saved credential';
    case 'shell': return 'Running a command in your workspace';
    case 'code_run': return `Running ${args.language ? titleCase(args.language) + ' ' : ''}code`;
    case 'build_page': return 'Building a page';
    case 'canvas_show': return args.title ? `Showing${quoted(args.title)} in Canvas` : 'Showing it in Canvas';
    case 'image_generate': return 'Creating an image';
    case 'composio_apps': return 'Checking your connected apps';
    case 'composio_tools': return args.toolkit ? `Checking what ${titleCase(args.toolkit)} can do` : 'Checking a connected app';
    case 'composio_execute': return args.tool ? `Using ${titleCase(String(args.tool).split('_')[0])}` : 'Using a connected app';
    case 'mail_status': return 'Checking the mailbox';
    case 'mail_list': return args.folder === 'sent' ? 'Checking sent mail' : 'Checking the inbox';
    case 'mail_read': return 'Reading an email';
    case 'mail_draft': return args.to ? `Drafting an email to ${clip(args.to, 32)}` : 'Drafting an email';
    case 'mail_send': return args.to ? `Sending an email to ${clip(args.to, 32)}` : 'Sending an email';
    case 'shop_status': return 'Checking Shop Pay';
    case 'product_search': return `Finding${args.query ? quoted(args.query) : ' products'}`;
    case 'shop_search': return `Searching shops${args.query ? ' for' + quoted(args.query) : ''}`;
    case 'shop_product': return 'Looking at a product';
    case 'shop_checkout': return 'Preparing checkout';
    case 'shop_purchase': return 'Completing the purchase';
    case 'shop_order': return 'Checking the order';
    case 'trigger_list': return 'Checking your automations';
    case 'trigger_create': return args.name ? `Setting up${quoted(args.name)}` : 'Setting up an automation';
    case 'goal_list': return 'Checking your goals';
    case 'goal_create': return args.title ? `Creating the goal${quoted(args.title)}` : 'Creating a goal';
    case 'goal_update': return args.status === 'done' ? 'Marking a goal done' : 'Updating a goal';
    case 'goal_delete': return 'Removing a goal';
    case 'library_list': return 'Looking through your Library';
    case 'library_read': return 'Opening a Library file';
    case 'library_save': return args.title ? `Saving${quoted(args.title)} to your Library` : 'Saving to your Library';
    case 'library_rename': return 'Renaming a Library file';
    case 'library_delete': return 'Deleting a Library file';
    default: return 'Using a tool';
  }
}

/* Splits the model's optional note off the real tool arguments. */
function splitActivity(rawArgs) {
  const { activity, ...args } = rawArgs && typeof rawArgs === 'object' ? rawArgs : {};
  return { args, note: clip(activity, 60) };
}

function withActivity(schema) {
  return { ...schema, parameters: { ...schema.parameters, properties: { ...(schema.parameters?.properties || {}), activity: ACTIVITY_PROP } } };
}

export { describeTool, splitActivity, withActivity };
