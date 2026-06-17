import anthropic
import aiohttp
import os

from dotenv import load_dotenv

load_dotenv()

SS_API = os.environ.get("SemanticSearch_API", "")


async def tool_fetch_paper_metadata(title: str) -> dict:
    
    url = "https://api.semanticscholar.org/graph/v1/paper/search"

    params = {"query":title,
              "limit":2,
              "fields":"title,authors,year,venue,s2FieldsOfStudy"}
    
    headers = {
        "x-api-key": SS_API 
    }

    async with aiohttp.ClientSession() as client:
        try: 
            async with client.get(url=url, params=params, headers=headers) as resp:
                    if resp.status != 200:
                        print(f'API error status : {resp.status}')
                        return None
                    
                    data = await resp.json()

                    results = data.get('data', [])

                    if not results:
                        return {"error": "No paper found matching that title."}

                    paper = results[0]
                    # Format the output cleanly for your agent
                    metadata = {
                        "title": paper.get("title"),
                        "authors": [author["name"] for author in paper.get("authors", [])],
                        "year": paper.get("year"),
                        "journal": paper.get("venue") or "Not specified",
                        "categories_fields": [f["category"] for f in paper.get("s2FieldsOfStudy", []) if "category" in f]
                    }
                    return metadata
        except Exception as e:
            return {"error": f'Request failed {e}'}



async def tool_executor(name: str, args: dict):
    if name == "tool_fetch_paper_metadata":
        return await tool_fetch_paper_metadata(args['title'])
    ValueError(f"Unknown tool: {name}")

tools = [
    {
        "name": "tool_fetch_paper_metadata",
        "description": "Returns the title authors, categories, journals and year of an academic paper given its title.",
        "input_schema":{
            "type": "object",
            "properties": {
                "title": {
                    "type": "string",
                    "description": "The title, e.g., 'A new approach...'."
                }
            },
            "required": ["title"]
        },   
    }
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
            