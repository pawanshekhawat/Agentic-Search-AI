import { createClient } from "@/lib/supabase/client"
import type { User } from "@supabase/auth-js/dist/module/lib/types"
import { use, useEffect, useState } from "react"
import { useNavigate } from "react-router"

const supabase = createClient()
export const Chat = () => {

    const [user, setUser] = useState<User | null>(null)

    useEffect(() => {
        async function getInfo() {
            const { data, error } = await supabase.auth.getUser()
            if (data.user) {
                setUser(data.user)
            }
        }
        getInfo()
    }, [])

    const navigate = useNavigate()

    return (
        <div>
            {!user && <button onClick={() => navigate("/auth")}>Sign in</button>}
            {user?.email}

            {user && <div> 
                {user.email}
                <button onClick={() => {
                    supabase.auth.signOut()
                    setUser(null)
                }}>Sign out</button>
            </div>}
        </div>
    )
}
