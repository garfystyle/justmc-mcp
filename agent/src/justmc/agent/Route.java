package justmc.agent;

import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.PriorityQueue;
import net.minecraft.client.multiplayer.ClientLevel;
import net.minecraft.core.BlockPos;
import net.minecraft.tags.FluidTags;
import net.minecraft.world.level.block.Blocks;
import net.minecraft.world.level.block.state.BlockState;
import net.minecraft.world.phys.shapes.VoxelShape;

final class Route {
    record Cell(int x, int y, int z) {}

    record Found(List<Cell> path, boolean reached, double left) {}

    private record Open(Cell cell, double g, double f) {}

    private static final int[][] MOVES = {{1, 0}, {-1, 0}, {0, 1}, {0, -1}, {1, 1}, {1, -1}, {-1, 1}, {-1, -1}};
    private static final int MAX_DROP = 3;
    private static final double LOW = 0.6;
    private static final double FENCE = 1.05;

    private final ClientLevel level;
    private final Map<Long, Double> tops = new HashMap<>();
    private final BlockPos.MutableBlockPos at = new BlockPos.MutableBlockPos();

    Route(ClientLevel level) {
        this.level = level;
    }

    private static long key(int x, int y, int z) {
        return (((long) x & 0x3FFFFFFL) << 38) | (((long) z & 0x3FFFFFFL) << 12) | ((long) y & 0xFFFL);
    }

    private double top(int x, int y, int z) {
        long k = key(x, y, z);
        Double known = tops.get(k);
        if (known != null) return known;
        at.set(x, y, z);
        BlockState state = level.getBlockState(at);
        double value;
        if (danger(state)) {
            value = 9;
        } else {
            VoxelShape shape = state.getCollisionShape(level, at);
            value = shape.isEmpty() ? 0 : shape.max(net.minecraft.core.Direction.Axis.Y);
        }
        tops.put(k, value);
        return value;
    }

    private static boolean danger(BlockState s) {
        return s.getFluidState().is(FluidTags.LAVA) || s.is(Blocks.FIRE) || s.is(Blocks.SOUL_FIRE) || s.is(Blocks.CACTUS)
                || s.is(Blocks.MAGMA_BLOCK) || s.is(Blocks.SWEET_BERRY_BUSH) || s.is(Blocks.WITHER_ROSE)
                || s.is(Blocks.POWDER_SNOW) || s.is(Blocks.CAMPFIRE) || s.is(Blocks.SOUL_CAMPFIRE) || s.is(Blocks.COBWEB);
    }

    private boolean water(int x, int y, int z) {
        at.set(x, y, z);
        return level.getFluidState(at).is(FluidTags.WATER);
    }

    private boolean air(int x, int y, int z) {
        return top(x, y, z) == 0 && top(x, y - 1, z) <= FENCE;
    }

    boolean stand(int x, int y, int z) {
        double feet = top(x, y, z);
        if (feet > LOW) return false;
        if (top(x, y - 1, z) > FENCE) return false;
        if (top(x, y + 1, z) != 0) return false;
        if (feet > 0 && top(x, y + 2, z) != 0) return false;
        if (water(x, y, z)) return true;
        return feet > 0 || top(x, y - 1, z) > 0;
    }

    private Integer floor(int x, int y, int z) {
        for (int d = 0; d <= MAX_DROP; d++) {
            if (stand(x, y - d, z)) return y - d;
            if (top(x, y - d, z) != 0) return null;
        }
        return null;
    }

    Cell snap(double x, double y, double z) {
        int cx = (int) Math.floor(x);
        int cz = (int) Math.floor(z);
        int cy = (int) Math.floor(y + 0.1);
        for (int d = 0; d <= 3; d++) {
            if (stand(cx, cy - d, cz)) return new Cell(cx, cy - d, cz);
            if (stand(cx, cy + d, cz)) return new Cell(cx, cy + d, cz);
        }
        return new Cell(cx, cy, cz);
    }

    private void around(Cell c, List<Object[]> out) {
        for (int[] m : MOVES) {
            int nx = c.x + m[0];
            int nz = c.z + m[1];
            boolean diagonal = m[0] != 0 && m[1] != 0;
            if (diagonal && (!(air(c.x + m[0], c.y, c.z) && air(c.x + m[0], c.y + 1, c.z))
                    || !(air(c.x, c.y, c.z + m[1]) && air(c.x, c.y + 1, c.z + m[1])))) {
                continue;
            }
            if (stand(nx, c.y, nz)) {
                out.add(new Object[] {new Cell(nx, c.y, nz), diagonal ? 1.41 : 1.0});
                continue;
            }
            if (diagonal) continue;
            if (stand(nx, c.y + 1, nz) && top(c.x, c.y + 2, c.z) == 0) {
                out.add(new Object[] {new Cell(nx, c.y + 1, nz), 2.0});
                continue;
            }
            if (top(nx, c.y, nz) == 0 && top(nx, c.y + 1, nz) == 0) {
                Integer landed = floor(nx, c.y - 1, nz);
                if (landed != null) out.add(new Object[] {new Cell(nx, landed, nz), 1.5 + (c.y - landed) * 0.3});
            }
        }
    }

    Found find(Cell from, Cell to, int limit) {
        Map<Cell, Double> best = new HashMap<>();
        Map<Cell, Cell> parent = new HashMap<>();
        PriorityQueue<Open> open = new PriorityQueue<>((a, b) -> Double.compare(a.f, b.f));
        best.put(from, 0.0);
        open.add(new Open(from, 0, heuristic(from, to)));
        Cell closest = from;
        double closestH = heuristic(from, to);
        List<Object[]> next = new ArrayList<>(8);
        for (int seen = 0; !open.isEmpty() && seen < limit; seen++) {
            Open top = open.poll();
            double h = heuristic(top.cell, to);
            if (h < closestH) {
                closest = top.cell;
                closestH = h;
            }
            if (h < 0.5) {
                closest = top.cell;
                closestH = 0;
                break;
            }
            next.clear();
            around(top.cell, next);
            for (Object[] n : next) {
                Cell cell = (Cell) n[0];
                double g = top.g + (double) n[1];
                Double was = best.get(cell);
                if (was != null && was <= g) continue;
                best.put(cell, g);
                parent.put(cell, top.cell);
                open.add(new Open(cell, g, g + heuristic(cell, to)));
            }
        }
        ArrayDeque<Cell> path = new ArrayDeque<>();
        for (Cell c = closest; c != null; c = parent.get(c)) path.addFirst(c);
        return new Found(new ArrayList<>(path), closestH < 0.5, closestH);
    }

    private static double heuristic(Cell a, Cell b) {
        return Math.hypot(a.x - b.x, a.z - b.z) + Math.abs(a.y - b.y) * 0.5;
    }

    List<Cell> simplify(List<Cell> path) {
        if (path.size() < 3) return path;
        List<Cell> out = new ArrayList<>();
        out.add(path.get(0));
        for (int i = 1; i < path.size() - 1; i++) {
            Cell a = out.get(out.size() - 1);
            Cell b = path.get(i + 1);
            boolean flat = a.y == b.y && path.get(i).y == a.y;
            if (!flat || !clear(a, b)) out.add(path.get(i));
        }
        out.add(path.get(path.size() - 1));
        return out;
    }

    private boolean clear(Cell a, Cell b) {
        int steps = (int) Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) * 3);
        for (int s = 1; s < steps; s++) {
            double t = (double) s / steps;
            double x = a.x + (b.x - a.x) * t;
            double z = a.z + (b.z - a.z) * t;
            for (double ox : new double[] {-0.3, 0.3}) {
                for (double oz : new double[] {-0.3, 0.3}) {
                    if (!stand((int) Math.round(x + ox), a.y, (int) Math.round(z + oz))) return false;
                }
            }
        }
        return true;
    }
}
