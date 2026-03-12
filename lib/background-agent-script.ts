// Background Python agent script that runs detached from the HTTP request.
// This script writes output to a JSON file incrementally, allowing the frontend
// to poll for results even if the browser is closed.

export function getBackgroundAgentScript(executionId: string): string {
  return `import os
import sys
import json
import asyncio
import traceback
from datetime import datetime

from claude_agent_sdk import ClaudeSDKClient, ClaudeAgentOptions, AssistantMessage, TextBlock, ToolUseBlock

# Output file path
OUTPUT_FILE = f"/tmp/agent_output_${executionId}.json"

# Initialize output state
output_state = {
    "executionId": "${executionId}",
    "messageId": os.environ.get("MESSAGE_ID", ""),
    "status": "running",
    "content": "",
    "toolCalls": [],
    "contentBlocks": [],  # Interleaved text and tool calls in order
    "error": None,
    "sessionId": None,
    "startedAt": datetime.utcnow().isoformat() + "Z",
    "updatedAt": datetime.utcnow().isoformat() + "Z"
}

# Track pending tool calls to batch them together
pending_tool_calls = []

def save_output():
    """Save current state to output file atomically."""
    output_state["updatedAt"] = datetime.utcnow().isoformat() + "Z"
    tmp_file = OUTPUT_FILE + ".tmp"
    with open(tmp_file, "w") as f:
        json.dump(output_state, f)
    os.rename(tmp_file, OUTPUT_FILE)

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

try:
    client = ClaudeSDKClient(options=ClaudeAgentOptions(**opts_kwargs))

    async def init_client():
        await client.__aenter__()

    run_sync(init_client())

    prompt = os.environ.get('PROMPT', '')

    async def run_query():
        global output_state
        await client.query(prompt)
        async for message in client.receive_response():
            if hasattr(message, 'subtype') and getattr(message, 'subtype', '') == 'init':
                data = getattr(message, 'data', None) or {}
                sid = data.get('session_id') if isinstance(data, dict) else None
                if sid:
                    output_state["sessionId"] = sid
                    with open('/home/daytona/.agent_session_id', 'w') as f:
                        f.write(sid)
                    save_output()
            elif isinstance(message, AssistantMessage):
                for block in message.content:
                    if isinstance(block, TextBlock):
                        text = block.text
                        if not text.endswith("\\n"):
                            text = text + "\\n"
                        output_state["content"] += text
                        # Flush any pending tool calls before adding text
                        if pending_tool_calls:
                            output_state["contentBlocks"].append({
                                "type": "tool_calls",
                                "toolCalls": pending_tool_calls.copy()
                            })
                            pending_tool_calls.clear()
                        # Add text block
                        output_state["contentBlocks"].append({
                            "type": "text",
                            "text": text
                        })
                        save_output()
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
                        tool_call = {
                            "tool": block.name,
                            "summary": summary
                        }
                        output_state["toolCalls"].append(tool_call)
                        pending_tool_calls.append(tool_call)
                        save_output()

    run_sync(run_query())

    # Flush any remaining pending tool calls
    if pending_tool_calls:
        output_state["contentBlocks"].append({
            "type": "tool_calls",
            "toolCalls": pending_tool_calls.copy()
        })
        pending_tool_calls.clear()

    # Mark as completed
    output_state["status"] = "completed"
    save_output()

except Exception as e:
    output_state["status"] = "error"
    output_state["error"] = str(e) + "\\n" + traceback.format_exc()
    save_output()
`
}

// Get the output file path for a given execution
export function getOutputFilePath(executionId: string): string {
  return `/tmp/agent_output_${executionId}.json`
}
