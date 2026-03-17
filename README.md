# 1. Qwen CLI
- qwen authenticate with gmail ids to qwen website
```bash
mkdir -p project-1
cd project-1

qwen
```
# 2. Claude Code cli + OpenRouter


- https://www.youtube.com/watch?v=GRUjApPqCoE
- https://openrouter.ai/
- https://openrouter.ai/models

##  Full setup guide.
- vi ~/.claude/settings.json
```json
{
  "env": {
    "ANTHROPIC_BASE_URL": "https://openrouter.ai/api",
    "ANTHROPIC_AUTH_TOKEN": "sk-or-v1-abcd...c=ty",
    "ANTHROPIC_API_KEY": "",
    "ANTHROPIC_MODEL": "openrouter/free",
    "ANTHROPIC_SMALL_FAST_MODEL": "openrouter/free"
  }
}

```

## Run claude code
```
mkdir -p project-1

cd project-2

claude
```

# 3. Claude Code Router + Qwen Token
- vi ~/.claude-code-router/config.json
```json
{  
  "LOG": true,  
  "LOG_LEVEL": "info",  
  "HOST": "127.0.0.1",  
  "PORT": 3456,  
  "API_TIMEOUT_MS": 600000,  
  "Providers": [  
    {  
      "name": "qwen",  
      "api_base_url": "https://portal.qwen.ai/v1/chat/completions",  
      "api_key": "cIRs-Qwen-Token-Get-By-qwen-cli-auth",  
      "models": [  
        "qwen3-coder-plus",  
        "qwen3-coder-plus",  
        "qwen3-coder-plus"  
      ]  
    }  
  ],  
  "Router": {  
    "default": "qwen,qwen3-coder-plus",  
    "background": "qwen,qwen3-coder-plus",  
    "think": "qwen,qwen3-coder-plus",  
    "longContext": "qwen,qwen3-coder-plus",  
    "longContextThreshold": 60000,  
    "webSearch": "qwen,qwen3-coder-plus"  
  }  
}

```

## Run claude code router
- On Bash Terminal 1
```bash
ccr start
```

## run ccr cli
- On Bash Terminal 2
```bash
mkdir -p project-1
ccr code
```
