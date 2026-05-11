import { createClient } from '../lib/supabase/client'


const supabase = createClient()
export default function Auth() {
    async function login(provider: 'google' | 'github') {
        const { data, error } = await supabase.auth.signInWithOAuth({
            provider: provider,
            options: {
                queryParams: {
                    access_type: 'offline',
                    prompt: 'consent',
                },
            },
        })
    }

    return (
        <div>
            <h1>Auth</h1>
            <button onClick={() => login("google")}>Login with Google</button>
            <button onClick={() => login("github")}>Login with GitHub</button>
        </div>
    );
}