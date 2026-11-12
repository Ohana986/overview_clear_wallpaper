(() => {
    const out = {
        stage: [global.stage.width, global.stage.height],
        monitors: Main.layoutManager.monitors.map(m => [m.x, m.y, m.width, m.height]),
        cards: [],
    };

    const found = [];
    const walk = actor => {
        for (const child of actor.get_children()) {
            if (child._bin && child._bgManager)
                found.push(child);
            walk(child);
        }
    };
    walk(Main.layoutManager.overviewGroup);

    for (const background of found) {
        const card = {monitorIndex: null, alloc: null, stageRect: null,
            state: null, paintOpacity: null, visible: null, mapped: null,
            binOpacity: null, chain: []};

        try {
            card.monitorIndex = background._monitorIndex;
        } catch {
            card.monitorIndex = null;
        }

        try {
            const box = background.get_allocation_box();
            card.alloc = [box.x1, box.y1, box.get_width(), box.get_height()];

            const ext = background.get_transformed_extents();
            card.stageRect = [ext.get_x(), ext.get_y(),
                ext.get_width(), ext.get_height()];
        } catch (e) {
            card.error = `${e}`;
        }

        try {
            card.state = background._stateAdjustment?.value ?? null;
            card.paintOpacity = background.get_paint_opacity();
            card.visible = background.visible;
            card.mapped = background.is_mapped();
            card.binOpacity = background._bin?.opacity ?? null;
        } catch {
            // Ignore destroyed actors.
        }

        let actor = background;
        while (actor && actor !== global.stage) {
            let alloc = null;
            let mapped = null;
            try {
                const box = actor.get_allocation_box();
                alloc = [box.x1, box.y1, box.get_width(), box.get_height()];
                mapped = actor.is_mapped();
            } catch {
                // Ignore.
            }
            card.chain.push({
                type: actor.constructor.name,
                name: actor.name ?? '',
                alloc,
                scale: [actor.scale_x, actor.scale_y],
                opacity: actor.opacity,
                visible: actor.visible,
                mapped,
            });
            actor = actor.get_parent();
        }

        out.cards.push(card);
    }

    return JSON.stringify(out);
})()
