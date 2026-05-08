import { tavily } from "@tavily/core"
import express from "express";

const client = tavily({ apiKey: process.env.TAVILY_API_KEY });
const app = express();

app.post("/ask", async (req, res) => {

    const query = req.body.query;

    const webSearchResponse = await client.search("",{
        searchDepth: "advanced"
    });

    const webSearchResults = webSearchResponse.results;

});
app.listen(3000, () => {
    console.log("Server is running on port 3000");
});