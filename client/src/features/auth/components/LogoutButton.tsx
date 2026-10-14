import { authClient } from "../api/authClient";
import { useState } from "react";
export default function LogoutButton() {

    const [error, setError] = useState("");
    const [loading, setLoading] = useState(false);

    async function handleClick() {

        setLoading(true);
        setError("");

        try {
            const result = await authClient.signOut()

            if (result.error) {
                setError(result.error.message ?? "Could not sign out");
            }
        } catch (error) {
            setError(error instanceof Error ? error.message : "Something went wrong.")
        } finally {
            setLoading(false);
        }
    }

    return (
        <>
            <button type="button" onClick={handleClick} disabled={loading}>
                {loading ? "Signing out..." : "Sign out"}
            </button>

            {error && <p role="alert">{error}</p>}
        </>
    )
}