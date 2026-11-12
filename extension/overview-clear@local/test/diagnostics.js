(() => {
    const out = {
        visible: Main.overview.visible,
        monitors: Main.layoutManager.monitors.map(m => [m.x, m.y, m.width, m.height]),
        transition: null,
        cards: [],
        extensionState: null,
    };

    try {
        const controls = Main.overview._overview._controls;
        const params = controls._stateAdjustment.getStateTransitionParams();
        out.transition = {
            state: controls._stateAdjustment.value,
            progress: params.progress,
            initialState: params.initialState,
            finalState: params.finalState,
        };
    } catch {
        out.transition = null;
    }

    const walk = actor => {
        for (const child of actor.get_children()) {
            if (child._bin && child._bgManager && child._stateAdjustment)
                describeCard(child);
            walk(child);
        }
    };

    const describeCard = background => {
        const monitor = Main.layoutManager.monitors[background._monitorIndex];
        const box = background.get_allocation_box();
        const actor = background._bgManager.backgroundActor;

        const actorBox = actor ? actor.get_allocation_box() : null;

        out.cards.push({
            monitor: background._monitorIndex,
            binOpacity: background._bin.opacity,
            allocation: [box.x1, box.y1, box.get_width(), box.get_height()],
            actor: actorBox ? {
                allocation: [
                    actorBox.x1,
                    actorBox.y1,
                    actorBox.get_width(),
                    actorBox.get_height(),
                ],
                scale: [actor.scale_x, actor.scale_y],
                clipRadius: actor.content?.rounded_clip_radius ?? null,
            } : null,
            monitorSize: monitor ? [monitor.width, monitor.height] : null,
            // A crop is active when the actor is larger than the card and
            // scaled by the inverse of the workspace scale.
            cropping: actorBox
                ? actorBox.get_width() > box.get_width() + 1 ||
                  Math.abs(actor.scale_x - 1) > 0.001
                : false,
        });
    };

    walk(Main.layoutManager.overviewGroup);

    try {
        const extension =
            Main.extensionManager.lookup('overview-clear@local');
        out.extensionState = extension?.state ?? null;
    } catch {
        out.extensionState = null;
    }

    return JSON.stringify(out);
})()
