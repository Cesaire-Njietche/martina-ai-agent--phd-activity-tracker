import asyncio
import json


from agents.agent import run_agent



sys = "You are my phd research assistant"
task = """I will give you the exact paper title.
        Title: "{title}"
        Return the metadata as a dictionary with keys surrended with double quotes.
        The title has to match almost perfectly. Consider punctuations differences and case sensitive
        If nothing found, return ERROR as the message
        Specified in which database you found it.
        """



#Enrich all the papers read in a given period
async def enrich_all(papers: list[dict[str, any]], sys=sys, task=task ) -> list[dict[str, any]]: 
    tasks = []
    for paper in papers:
        if paper.get('metadata').get('title'):
            t = run_agent(sys, 
                        task.format(title=paper.get('metadata').get('title')))
            tasks.append(t)

    #### Fan-out
    results = await asyncio.gather(*tasks, return_exceptions=True)

    enriched_papers = []
    for paper, r in zip(papers, results):
        # If the task raised a hard exception, handle it gracefully
        
        if isinstance(r, Exception):
            print(f"[Batch Error] Hard failure trying to enrich '{paper.get('metadata').get('title')}': {r}")
            paper["enrichment_error"] = str(r)
            enriched_papers.append(paper)

        # If the tool returned our structured error dictionary
        elif "ERROR" in r:
            #print(f"[Batch Warning] {r['error']}")
           
            paper["enrichment_error"] = "error"
            enriched_papers.append(paper)
        # Success! Merge the new metadata into the original paper dictionary
        elif '{' and '}' in r:
            # Merge fields cleanly (this updates paper with title, authors, abstract, etc.)
            s = r.index('{')
            e = r.index('}') + 1

            result = {}
            d = json.loads(r[s:e])
            #print(d)
            for k, v in d.items():
                result[k] = v
            paper['metadata'] = {**paper.get('metadata'), **result}
            enriched_paper = paper
            enriched_papers.append(enriched_paper)
    
    ### Fan-in
    return enriched_papers
            