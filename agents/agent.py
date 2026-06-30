import anthropic
import aiohttp
import asyncio
import os

from agents.failure_modes import retry
from dotenv import load_dotenv

load_dotenv()

# *************** Tool 1 implementation ******************

class APIRequestError(Exception): pass
SS_API = os.environ.get("SemanticSearch_API", "")
OA_API = os.environ.get('OpenAlex_API')

@retry(max_attempts=4, base_delay=1.5, exceptions=(APIRequestError, asyncio.TimeoutError))
async def tool_fetch_paper_metadata(title: str) -> dict:
    
    url_ss = "https://api.semanticscholar.org/graph/v1/paper/search"
    url_oa = "https://api.openalex.org/works"
    params_ss = {"query":title,
              "limit":2,
              "fields":"title,authors,year,venue,s2FieldsOfStudy"}
    params_oa = {"search":title,
              "per_page":1,
              "api_key":OA_API}
    headers = {
        "x-api-key": "s2k-2lQ5KCMYCrx40aWaGrNbEHybya4rCvy7yanFvwJp"
    }

    async with aiohttp.ClientSession() as client:
        
        async with client.get(url=url_ss, params=params_ss, headers=headers) as resp:
    
                if resp.status in [429, 500]:
                    # Trigger the retry decorator logic
                    raise APIRequestError(f"Transient upstream failure: Status {resp.status}")
                if resp.status != 200:
                    print(f'API error status : {resp.status}')
                    return None # Do NOT retry a 404 or unrecoverable error

                data = await resp.json()

                results = data.get('data', [])

                if not results:      
                    async with client.get(url=url_oa, params=params_oa) as resp:
                        if resp.status != 200:
                            print(f'API error status : {resp.status}')
                            return None

                        
                        data = await resp.json()

                        results = data.get('results', [])
                        if not results:
                            return {"error": "No paper found matching that title."}

                        paper = results[0]

                        authorships = paper.get("authorships", [])
                        authors = [a.get("author", {}).get("display_name") for a in authorships if a.get("author")]
                        fields = [c.get("display_name") for c in paper.get("concepts", []) if "display_name" in c]        

                        metadata =  {
                            "title": paper.get("title"),
                            "authors": [name for name in authors if name],
                            "year": paper.get("publication_year"),
                            "journal": paper.get("primary_location", {}).get("source", {}).get("display_name") or "Not specified",
                            "fields": fields,
                            "database": "OpenAlex"
                        }

                        return metadata
                                   
                    #return {"error": "No paper found matching that title."}
                    
                paper = results[0]
                # Format the output cleanly for your agent
                metadata = {
                        "title": paper.get("title"),
                        "authors": [author["name"] for author in paper.get("authors", [])],
                        "year": paper.get("year"),
                        "journal": paper.get("venue") or "Not specified",
                        "fields": [f["category"] for f in paper.get("s2FieldsOfStudy", []) if "category" in f],
                        "database": "semantic scholar"
                    }
                return metadata


async def tool_executor(name: str, args: dict):
    if name == "tool_fetch_paper_metadata":
        return await tool_fetch_paper_metadata(args['title'])
    ValueError(f"Unknown tool: {name}")

tools = [
    {
        "name": "tool_fetch_paper_metadata",
        "description": """Fetch title, authors, abstract, and year for one academic paper from Semantic Scholar. 
        Use this when you have a paper title and need metadata. 
        Do NOT call this if metadata is already present in the input.""",
        "input_schema":{
            "type": "object",
            "properties": {
                "title": {
                    "type": "string",
                    "description": "A paper title, e.g., 'A new approach...'."
                }
            },
            "required": ["title"]
        },   
    },
    {
        "name": "tool_save_classification",
        "description": """Save domain classification for one paper. 
        Call once per paper after determining its domains. 
        Do not batch multiple papers in one call.""",
        "input_schema": {
            "type": "object",
            "properties":{
                "event_id": {"type": "string"},
                "domain":{
                    "type": "array",
                    "items":{
                        "type": "string",
                        "enum":['QEC', "Neural Network", "Cybersecurity"]
                    }
                    
                },
                "confidence": {"type": "number", "minimum": 0, "maximum": 1},
                "note": {"type": "string", "description": "One sentence why."},
            },
            "required": ["event_id", "domains", "confidence"]
        }
    },
]

async def run_agent(
        system: str, 
        task: str, 
        tools: list[dict] = tools, 
        tools_executor = tool_executor,
        model: str = "claude-haiku-4-5",
        max_iterations: int = 10
        ) -> str:
    
    client = anthropic.Anthropic()
    message = [{"role": "user", "content": task}]

    for _ in range(max_iterations):
       
        response = client.messages.create(
            model=model,
            system=system,
            tools=tools,
            max_tokens=1024,
            messages=message
        )

        if response.stop_reason == "tool_use":
            tool_calls = [c for c in response.content if c.type == "tool_use"]

            tool_results = []

            for c in tool_calls:
                r = await tools_executor(c.name, c.input)
                tool_results.append({
                    "type": "tool_result",
                    "tool_use_id": c.id,
                    "content": str(r)
                })
            
            message.append({"role": "assistant", "content":response.content })
            message.append({"role": "user", "content": tool_results})

        elif response.stop_reason == "end_turn":
            final_result = next(t for t in response.content if t.type == "text")
            #print(final_result.text)
            return final_result.text