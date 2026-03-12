// Python coding agent script that runs inside the Daytona sandbox.

// This is uploaded to the sandbox and executed via the code interpreter.
// Note: \\n in the template literal becomes \n in the output string,
// which Python interprets as a newline character in string literals.

export const CODING_AGENT_SCRIPT = `import os
import logging
import sys
import asyncio

from claude_agent_sdk import ClaudeSDKClient, ClaudeAgentOptions, AssistantMessage, TextBlock, ToolUseBlock

logging.getLogger('claude_agent_sdk').setLevel(logging.WARNING)

def run_sync(coro):
    loop = asyncio.get_event_loop()
    return loop.run_until_complete(coro)

loop = asyncio.new_event_loop()
asyncio.set_event_loop(loop)

repo_path = os.environ.get('REPO_PATH', '/home/daytona')
os.chdir(repo_path)

system_prompt = """You are an AI coding agent running in a Daytona sandbox.
The repository is cloned at {path}.
You are working on the git branch that is currently checked out.
Use this directory for all file operations.
Always check the current state of files before editing them.
After making meaningful changes, commit them with a descriptive message using git add and git commit.
Do not push — pushing is handled automatically.
When you finish a task, provide a clear summary of what you did.
""".format(path=repo_path)

preview_url_pattern = os.environ.get('PREVIEW_URL_PATTERN', '')
if preview_url_pattern:
    example_url = preview_url_pattern.replace('{port}', '3000')
    system_prompt += """
If you start a server or service on any port, provide the user with the preview URL.
The preview URL pattern is: """ + preview_url_pattern + """
Replace {port} with the actual port number. For example, if you start a server on port 3000, the URL is: """ + example_url + """
"""

resume_session = os.environ.get('RESUME_SESSION_ID', '')
opts_kwargs = dict(
    allowed_tools=["Read", "Edit", "Write", "Glob", "Grep", "Bash"],
    permission_mode="bypassPermissions",
    system_prompt=system_prompt,
)
if resume_session:
    opts_kwargs['resume'] = resume_session

client = ClaudeSDKClient(options=ClaudeAgentOptions(**opts_kwargs))

async def init_client():
    await client.__aenter__()
    print("Agent SDK is ready.")

run_sync(init_client())

async def run_query(prompt):
    await client.query(prompt)
    async for message in client.receive_response():
        # First message is system init with session_id (same as SDK docs: subtype == "init", session_id in message.data)
        if hasattr(message, 'subtype') and getattr(message, 'subtype', '') == 'init':
            data = getattr(message, 'data', None) or {}
            sid = data.get('session_id') if isinstance(data, dict) else None
            if sid:
                    sys.stdout.write("SESSION_ID:" + sid + "\\n")
                    sys.stdout.flush()
                    with open('/home/daytona/.agent_session_id', 'w') as f:
                        f.write(sid)
        elif isinstance(message, AssistantMessage):
            for block in message.content:
                if isinstance(block, TextBlock):
                    text = block.text
                    if not text.endswith("\\n"):
                        text = text + "\\n"
                    sys.stdout.write(text)
                    sys.stdout.flush()
                elif isinstance(block, ToolUseBlock):
                    detail = ""
                    inp = getattr(block, "input", {}) or {}
                    if block.name == "Bash" and inp.get("command"):
                        cmd = inp["command"]
                        if len(cmd) > 80:
                            cmd = cmd[:80] + "..."
                        detail = cmd
                    elif block.name in ("Read", "Edit", "Write") and inp.get("file_path"):
                        detail = inp["file_path"].split("/")[-1]
                    elif block.name == "Glob" and inp.get("pattern"):
                        detail = inp["pattern"]
                    elif block.name == "Grep" and inp.get("pattern"):
                        detail = inp["pattern"]
                    summary = block.name + (": " + detail if detail else "")
                    sys.stdout.write("TOOL_USE:" + summary + "\\n")
                    sys.stdout.flush()

def run_query_sync(prompt):
    return run_sync(run_query(prompt))
`
