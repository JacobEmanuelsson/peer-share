import { useState, type SubmitEvent } from "react";
import { authClient } from "./api/authClient";

export default function LoginForm() {

    const [loading, setLoading] = useState(false);
    const [success, setSuccess] = useState(false);
    const [error, setError] = useState("");

    async function handleSubmit(event:SubmitEvent<HTMLFormElement>) {
        
        event.preventDefault();
        setError("");
        setLoading(false);
        setSuccess(false);

        const formData = new FormData(event.currentTarget);

        const password = formData.get("password");
        const email = formData.get("email");

        if (typeof password !== "string" || typeof email !== "string") {
            setError("Input must be a string");
            return;
        }
        try {
            setLoading(true);

            const result = await authClient.signIn.email({email, password});

            if(result.error) {
                setError(result.error.message ?? "Login failed");
            }
            
            setSuccess(true);
        }catch (error) {
            setError(error instanceof Error ? error.message : "Something went wrong");
        } finally {
            setLoading(false);
        }

    }


    return (
        <form onSubmit={handleSubmit}>
            <label htmlFor="email">
                Email
            </label>
            <input type="email" name="email" id="email" autoComplete="email" placeholder="Example@email.com" required/>

            <label htmlFor="password">
                Password
            </label>
            <input type="password" name="password" id="password" autoComplete="current-password" placeholder="Password" required/>

            <button type="submit" disabled={loading}>
                {loading ? "Logging in..." : "Login"}
            </button>

            {error && <p role="alert">{error}</p>}
            {success && <output aria-live="polite">You logged in</output>}
        </form>
    )
}