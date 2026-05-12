"""
List available LLM configurations from mykey.py using GA's own logic.
Output: JSON array of {index, name, type} objects.
Usage: python list_llms.py --ga-root <path>
"""
import sys, os, json, argparse

parser = argparse.ArgumentParser()
parser.add_argument('--ga-root', required=True)
args = parser.parse_args()

ga_root = os.path.abspath(args.ga_root)
sys.path.insert(0, ga_root)
os.chdir(ga_root)

try:
    from llmcore import reload_mykeys, resolve_client, MixinSession
    mykeys, _ = reload_mykeys()

    llm_configs = []
    for k, cfg in mykeys.items():
        if 'mixin' in k:
            # Mixin config - extract model list from llm_nos
            models = []
            if isinstance(cfg, dict) and 'llm_nos' in cfg:
                models = cfg['llm_nos']
            llm_configs.append({
                'key': k,
                'type': 'mixin',
                'name': f"Mixin ({', '.join(models[:3])}{'...' if len(models) > 3 else ''})" if models else f"Mixin ({k})",
                'models': models,
            })
        else:
            # Single model config
            model_name = ''
            if isinstance(cfg, dict):
                model_name = cfg.get('model', cfg.get('model_name', ''))
            name = model_name or k.replace('native_', '').replace('_config', '').replace('_', ' ').title()
            session_type = 'native_claude' if 'claude' in k else 'native_oai' if 'oai' in k else 'unknown'
            llm_configs.append({
                'key': k,
                'type': session_type,
                'name': name,
                'model': model_name,
            })

    # Output as JSON
    result = []
    for i, cfg in enumerate(llm_configs):
        result.append({'index': i, 'name': cfg['name'], 'type': cfg['type'], 'key': cfg['key']})

    print(json.dumps(result, ensure_ascii=False))
except Exception as e:
    print(json.dumps({'error': str(e)}), file=sys.stderr)
    sys.exit(1)
