
import os
from dotenv import load_dotenv
from google import genai

load_dotenv(override=True)

api_key = os.getenv("GEMINI_API_KEY")
model = os.getenv("GEMINI_MODEL", "gemini-3.5-flash-lite")

if not api_key:
    raise SystemExit("GEMINI_API_KEY is missing.")

client = genai.Client(api_key=api_key)

try:
    response = client.models.generate_content(
        model=model,
        contents='Return exactly this JSON: {"status":"working"}',
        config={
            "response_mime_type": "application/json",
            "max_output_tokens": 256,
            "temperature": 0,
        },
    )

    print("MODEL:", model)
    print("FINISH REASON:", response.candidates[0].finish_reason)
    print("RESPONSE:", repr(response.text))

finally:
    client.close()
