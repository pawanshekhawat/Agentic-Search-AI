import { tavily } from "@tavily/core"
import express from "express";
import { Output, streamText } from "ai";
import { google } from '@ai-sdk/google';
import { SYSTEM_PROMPT, PROMPT_TEMPLATE } from "./promt";
import z from "zod";
import { prisma } from "./db";

const client = tavily({ apiKey: process.env.TAVILY_API_KEY });
const app = express();

app.use(express.json());

// Sinup
app.post("/signup", async (req, res) => {

})

//Signin
app.post("/signin", async (req, res) => {

})

// Past conversations get
app.get("/conversations", async (req, res) => {

})

// Past conversation get by id
app.get("/conversations/:id", async (req, res) => {

})

app.post("/atreus_ask", async (req, res) => {
    //Step 1: Get the query from the user
    const query = req.body.query;
    //Step 2: make sure user has access/credits to hit the endpoint

    //Step 3: check if we have web search indexed for similar queries

    //Step 4: if no then use web search to gather sources
    const webSearchResponse = await client.search(query, {
        searchDepth: "advanced"
    });

    const webSearchResults = webSearchResponse.results;
    //Step 5: do some context engineering on the prompt + web search responses

    //Step 6: hit the LLM and stream back the response

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

    //Step 7: also stream back the sources and the follow up questions (which we can get from another parellel LLM call)
    res.write(JSON.stringify(webSearchResults.map(result => ({ url: result.url }))));

    //Step 8: Close the event stream
    res.write("\n</SOURCES>\n");
    res.end();
})

app.post("/atreus_ask/followups", async (req, res) => {
    //Step 1: get the existing chat from the db
    //Step 2: forawrd the full history to the LLM
    //Step 2.5: TODO: Do context engineering here.
    //Step 3: stream the response back to the user 
})

app.listen(3000, () => {
    console.log("Server is running on port 3000");
});