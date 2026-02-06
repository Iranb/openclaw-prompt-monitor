# Prompt Monitor Plugin

Records prompts at two stages and saves them to a configurable cache directory:

- **Before hooks**: Prompt from Reply layer (session hints, system events, untrusted context, thread starter, media note, etc.). This is the `params.prompt` before any `before_agent_start` hook runs.
- **After hooks**: Final prompt actually sent to the model (includes `prependContext` from all plugins).

## Installation

```bash
openclaw plugins install Iranb/openclaw-prompt-monitor
```

Or 

```bash
openclaw plugins install https://github.com/Iranb/openclaw-prompt-monitor
```

## Configuration

Add to `~/.openclaw/openclaw.json`:

```json5
{
  plugins: {
    entries: {
      "prompt-monitor": {
        enabled: true,
        config: {
          saveBeforeHook: true,
          saveAfterHook: true
        }
      }
    }
  }
}
```

### Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `enabled` | boolean | `true` | Enable the plugin |
| `cacheDir` | string | system temp dir | Directory to save prompt logs; default uses `os.tmpdir()` (cleared on reboot). Set to e.g. `~/.openclaw/cache/prompt-monitor` for persistent storage |
| `saveBeforeHook` | boolean | `true` | Save prompt before `before_agent_start` hooks |
| `saveAfterHook` | boolean | `true` | Save final prompt sent to the model |

### Examples

```json5
// Only save the final prompt sent to the model
{
  plugins: {
    entries: {
      "prompt-monitor": {
        config: {
          saveBeforeHook: false,
          saveAfterHook: true
        }
      }
    }
  }
}
```

```json5
// Only save the prompt before hooks (Reply layer output)
{
  plugins: {
    entries: {
      "prompt-monitor": {
        config: {
          saveBeforeHook: true,
          saveAfterHook: false
        }
      }
    }
  }
}
```

### Output files

Files are named `{sessionKey}_{timestamp}_{before|after}.txt`, for example:

- `main_1701234567890_before.txt` — prompt before hooks
- `main_1701234567890_after.txt` — final prompt sent to model
