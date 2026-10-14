
import os
from dotenv import load_dotenv
from google import genai

load_dotenv()

api_key = os.getenv("GEMINI_API_KEY")

if not api_key:
    print("ERROR: GEMINI_API_KEY is missing from backend/.env")
    raise SystemExit(1)

client = genai.Client(api_key=api_key)

try:
    print("Models available to your API key:\n")

    for model in client.models.list():
        name = getattr(model, "name", None)
        actions = getattr(model, "supported_actions", None)

        if name:
            print(f"Model: {name}")
            print(f"Supported actions: {actions}")
            print("-" * 45)

except Exception as exc:
    print(f"Model listing failed: {type(exc).__name__}: {str(exc)[:400]}")

finally:
    client.close()
