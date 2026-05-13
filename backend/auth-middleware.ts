import type { NextFunction, Request, Response } from "express";
import { createSupabaseClient } from "./client";
import { prisma } from "./db";

declare global {
    namespace Express {
        interface Request {
            userId?: string;
        }
    }
}

const client = createSupabaseClient()
export async function middleware(req: Request, res: Response, next: NextFunction) {
    if (req.method === "OPTIONS") {
        return next();
    }

    const authHeader = req.headers.authorization;


    if (!authHeader || !authHeader.startsWith("Bearer ")) {
        return res.status(401).json({
            error: "Missing or invalid Authorization header"
        });
    }
    const token = authHeader.slice("Bearer ".length).trim();
    if (!token) {
        return res.status(401).json({
            error: "Missing bearer token"
        });
    }

    const data = await client.auth.getUser(token)
    const user = data.data.user
    if (user) {
        try {
            await prisma.user.upsert({
                where: {
                    id: user.id
                },
                update: {},
                create: {
                    id: user.id,
                    email: user.email!,
                    provider:
                        user.app_metadata.provider === "google"
                            ? "Google"
                            : "Github",
                    name: user.user_metadata.full_name
                }
            })
        } catch (e) {
            console.log(e);
        }

        req.userId = user.id
        next()
    } else {
        res.status(401).json({
            error: data.error?.message || "Invalid or expired token"
        })
    }
}
