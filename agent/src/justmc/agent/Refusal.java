package justmc.agent;

final class Refusal extends RuntimeException {
    private static final long serialVersionUID = 1L;

    Refusal(String why) {
        super(why, null, false, false);
    }
}
