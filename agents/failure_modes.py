"""
Error Mode:
- 429: Semantic Scholar returns 429 when we exceed 100 req/s
- 529: The Anthropic API returns a 529 overload error during peak times.
- 404: Paper not found

"""

import asyncio
import random
import time
from functools import wraps

def retry(max_attempts: int = 3, base_delay: float = 1.0, exceptions: tuple = (Exception,)):
    """
    Decorator for automatic retry with exponential backoff and random jitter.
    Prevents the 'thundering herd' problem on 429/529 errors.
    """
    def decorator(func):
        @wraps(func)
        async def wrapper(*args, **kwargs):
            attempt = 0
            while True:
                try:
                    return await func(*args, **kwargs)
                except exceptions as e:
                    attempt += 1
                    if attempt >= max_attempts:
                        print(f"[Retry] Max attempts ({max_attempts}) reached. Failing.")
                        raise e
                    
                    # Calculate exponential delay: base_delay * 2^attempt
                    delay = base_delay * (2 ** attempt)
                    # Add random jitter (plus or minus 25% of the delay window)
                    jitter = random.uniform(-0.25 * delay, 0.25 * delay)
                    total_delay = max(0.1, delay + jitter)
                    
                    print(f"[Retry] Caught {type(e).__name__}: {e}. "
                          f"Attempt {attempt}/{max_attempts}. Retrying in {total_delay:.2f}s...")
                    
                    await asyncio.sleep(total_delay)
        return wrapper
    return decorator