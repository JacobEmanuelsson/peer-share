import { useState, type SubmitEvent } from "react";
import { authClient } from "./api/authClient";

export default function SignupForm() {

    const [success, setSuccess] = useState(false);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState("");

    async function handleSubmit(event:SubmitEvent<HTMLFormElement>) {

        event.preventDefault();
        setSuccess(false);
        setError("");

        const formData = new FormData(event.currentTarget);

        const name = formData.get("name");
        const email = formData.get("email");
        const password = formData.get("password");

        if (typeof name !== "string" ||
            typeof email !== "string" ||
            typeof password !== "string"
        ) {
            setError("Input must be a string");
            return;
        }

        setLoading(true);

        try {
            const result = await authClient.signUp.email({name, email, password});

            if (result.error) {
                setError(result.error.message ?? "Could not create an acount.");
                return;
            }
            setSuccess(true);
        } catch (error) {
            setError(error instanceof Error ? error.message : "Something went wrong");
        } finally {
            setLoading(false)
        }


    }

    return (
        <form onSubmit={handleSubmit}>
            <label htmlFor="email">
                Email
            </label>
            <input type="email" name="email" id="email" placeholder="Example@email.com" autoComplete="email" required />

            <label htmlFor="name">
                Name
            </label>
            <input type="text" name="name" id="name" placeholder="Name" autoComplete="name" required/>

            <label htmlFor="password">
                Password
            </label>
            <input type="password" name="password" id="password" placeholder="Password" autoComplete="new-password" minLength={8} required/>

            <button type="submit" disabled={loading}>
                {loading ? "Creating account..." : "Create account"}
            </button>

            {error && <p role="alert">{error}</p>}
            {success && <output aria-live="polite">Your account was created.</output>}

        </form>
    )
}