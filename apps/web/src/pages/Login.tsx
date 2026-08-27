import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabase.js";

export default function Login() {
  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(false);
  const navigate = useNavigate();

  async function entrar(e: React.FormEvent) {
    e.preventDefault();
    setCarregando(true);
    setErro(null);
    const { error } = await supabase.auth.signInWithPassword({ email, password: senha });
    setCarregando(false);
    if (error) {
      setErro(error.message);
      return;
    }
    navigate("/");
  }

  return (
    <div
      style={{
        height: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "var(--bg)",
      }}
    >
      <form
        onSubmit={entrar}
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 14,
          width: 320,
          background: "var(--bg-raised)",
          border: "1px solid var(--border-soft)",
          borderRadius: 10,
          padding: 28,
        }}
      >
        <div>
          <div style={{ fontSize: 16, fontWeight: 700, color: "var(--text-1)" }}>Entrar</div>
          <div style={{ fontSize: 12.5, color: "var(--text-3)", marginTop: 2 }}>
            Painel de atendimentos
          </div>
        </div>

        <input
          type="email"
          placeholder="E-mail"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          style={inputStyle}
        />
        <input
          type="password"
          placeholder="Senha"
          value={senha}
          onChange={(e) => setSenha(e.target.value)}
          required
          style={inputStyle}
        />

        {erro && <div style={{ fontSize: 12, color: "var(--red)" }}>{erro}</div>}

        <button
          type="submit"
          disabled={carregando}
          style={{
            marginTop: 4,
            background: "var(--text-1)",
            color: "var(--bg)",
            border: "none",
            borderRadius: 7,
            padding: "9px 0",
            fontWeight: 700,
            fontSize: 13,
            opacity: carregando ? 0.6 : 1,
          }}
        >
          {carregando ? "Entrando…" : "Entrar"}
        </button>
      </form>
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  background: "var(--bg-card)",
  border: "1px solid var(--border-soft)",
  borderRadius: 7,
  padding: "9px 12px",
  fontSize: 13,
  color: "var(--text-1)",
  outline: "none",
  fontFamily: "inherit",
};
