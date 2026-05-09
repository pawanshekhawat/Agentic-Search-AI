import { tavily } from "@tavily/core"
import express from "express";
import { Output, streamText } from "ai";
import { google } from '@ai-sdk/google';
import { SYSTEM_PROMPT, PROMPT_TEMPLATE } from "./promt";
import z from "zod";

const client = tavily({ apiKey: process.env.TAVILY_API_KEY });
const app = express();

app.use(express.json());

app.post("/atreus_ask", async (req, res) => {
    const query = req.body.query;

    const webSearchResponse = await client.search(query, {
        searchDepth: "advanced"
    });

    const webSearchResults = webSearchResponse.results;

    const prompt = PROMPT_TEMPLATE.replace("{{WEB_SEARCH_RESULTS}}", JSON.stringify(webSearchResponse))
        .replace("{{USER_QUERY}}", query);

    const result = streamText({
        model: google('gemini-2.5-flash'),
        prompt: prompt,
        system: SYSTEM_PROMPT,
        output: Output.object({
            schema: z.object({
                followUps: z.array(z.string()),
                answer: z.string()
            }),
        }),
    })

    res.header('Cache-Control', 'no-cache');
    res.header('Content-Type', 'text/event-stream');
    for await (const textPart of result.textStream) {
        res.write(textPart);
    }
    res.write("\n<SOURCES>\n")

    res.write(JSON.stringify(webSearchResults.map(result => ({ url: result.url }))));

    res.write("\n</SOURCES>\n");
    res.end();
})


app.listen(3000, () => {
    console.log("Server is running on port 3000");
});